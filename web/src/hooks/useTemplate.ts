import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { ApiError } from "../api/client.js";
import {
  type TemplateRow,
  getTemplate,
  patchTemplate,
} from "../api/templates.js";

// ---------------------------------------------------------------------------
// Types

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface TemplateData {
  loading: boolean;
  loadError: ApiError | null;
  mjml: string;
  version: number;
  name: string;
  description: string | null;
  status: SaveStatus;
  apiKeyMissing: boolean;
  conflictToast: boolean;
  rateLimitToast: boolean;
  templateDeleted: boolean;
  pendingPatch: { mjml: string } | null;
}

export interface TemplateActions {
  save: (nextMjml: string) => void;
  forceSave: () => Promise<void>;
  applyServerWrite: (mjml: string, version: number) => void;
  patchMeta: (patch: { name?: string; description?: string | null }) => void;
  cancelPendingSave: () => void;
  refetch: () => Promise<void>;
  dismissConflictToast: () => void;
  dismissRateLimitToast: () => void;
}

// ---------------------------------------------------------------------------
// Context (split per ralplan §4 / Critic M2)

export const TemplateDataContext = createContext<TemplateData | null>(null);
export const TemplateActionsContext = createContext<TemplateActions | null>(null);

export function useTemplateData(): TemplateData {
  const v = useContext(TemplateDataContext);
  if (!v) throw new Error("useTemplateData must be used inside <TemplateRoute>");
  return v;
}

export function useTemplateActions(): TemplateActions {
  const v = useContext(TemplateActionsContext);
  if (!v) throw new Error("useTemplateActions must be used inside <TemplateRoute>");
  return v;
}

// ---------------------------------------------------------------------------
// Reducer (pure)

interface State extends TemplateData {
  retryAttempt: number;
}

type Action =
  | { type: "LOAD_OK"; row: TemplateRow }
  | { type: "LOAD_ERR"; error: ApiError }
  | { type: "DIRTY"; mjml: string }
  | { type: "SAVE_START" }
  | { type: "PATCH_OK"; mjml: string; version: number }
  | { type: "PATCH_409" }
  | { type: "PATCH_412" }
  | { type: "PATCH_429" }
  | { type: "PATCH_404" }
  | { type: "PATCH_413" }
  | { type: "PATCH_5XX" }
  | { type: "GIVE_UP" }
  | { type: "SAVED_TIMEOUT" }
  | { type: "SERVER_WRITE"; mjml: string; version: number }
  | { type: "REFETCH_OK"; row: TemplateRow }
  | { type: "META_PATCH"; row: TemplateRow }
  | { type: "DISMISS_CONFLICT" }
  | { type: "DISMISS_RATELIMIT" }
  | { type: "CANCEL_PENDING" };

const INITIAL: State = {
  loading: true,
  loadError: null,
  mjml: "",
  version: 0,
  name: "",
  description: null,
  status: "idle",
  apiKeyMissing: false,
  conflictToast: false,
  rateLimitToast: false,
  templateDeleted: false,
  pendingPatch: null,
  retryAttempt: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOAD_OK":
      return {
        ...state,
        loading: false,
        loadError: null,
        mjml: action.row.mjml,
        version: action.row.version,
        name: action.row.name,
        description: action.row.description,
      };
    case "LOAD_ERR":
      return { ...state, loading: false, loadError: action.error };
    case "DIRTY":
      return { ...state, status: "saving", pendingPatch: { mjml: action.mjml } };
    case "SAVE_START":
      return { ...state, status: "saving" };
    case "PATCH_OK":
      // The server is authoritative on version; we keep `mjml` in sync with
      // the bytes the client just sent so the canvas's parse-on-version-change
      // effect doesn't snap back to the pre-edit value.
      return {
        ...state,
        status: "saved",
        mjml: action.mjml,
        version: action.version,
        pendingPatch: null,
        retryAttempt: 0,
      };
    case "SAVED_TIMEOUT":
      return state.status === "saved" ? { ...state, status: "idle" } : state;
    case "PATCH_409":
      return { ...state, status: "idle", pendingPatch: null, conflictToast: true };
    case "REFETCH_OK":
      return {
        ...state,
        mjml: action.row.mjml,
        version: action.row.version,
        name: action.row.name,
        description: action.row.description,
      };
    case "META_PATCH":
      return {
        ...state,
        version: action.row.version,
        name: action.row.name,
        description: action.row.description,
      };
    case "PATCH_412":
      return { ...state, status: "idle", apiKeyMissing: true };
    case "PATCH_429":
      return { ...state, status: "idle", rateLimitToast: true };
    case "PATCH_404":
      return { ...state, status: "idle", templateDeleted: true, pendingPatch: null };
    case "PATCH_413":
      return { ...state, status: "idle", rateLimitToast: true };
    case "PATCH_5XX":
      return { ...state, status: "saving", retryAttempt: state.retryAttempt + 1 };
    case "GIVE_UP":
      return { ...state, status: "error" };
    case "SERVER_WRITE":
      return {
        ...state,
        mjml: action.mjml,
        version: action.version,
        pendingPatch: null,
        retryAttempt: 0,
        status: "idle",
      };
    case "DISMISS_CONFLICT":
      return { ...state, conflictToast: false };
    case "DISMISS_RATELIMIT":
      return { ...state, rateLimitToast: false };
    case "CANCEL_PENDING":
      return { ...state, status: "idle", pendingPatch: null };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Backoff schedule

const BACKOFF_MS = [250, 500, 1000, 2000, 4000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
const DEBOUNCE_MS = 1000;
const SAVED_INDICATOR_MS = 2000;

// ---------------------------------------------------------------------------
// Hook

export interface UseTemplateOptions {
  /** Injectable for tests — defaults to setTimeout/clearTimeout/visibilitychange. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function useTemplate(id: string, opts: UseTemplateOptions = {}) {
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Refs for closure stability — actions read these instead of stale state.
  const stateRef = useRef(state);
  stateRef.current = state;
  const versionRef = useRef(0);
  versionRef.current = state.version;
  const pendingPatchRef = useRef<{ mjml: string } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const initialLoadAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const forceSaveResolversRef = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  // Initial load (StrictMode-safe via abort + mountedRef)
  useEffect(() => {
    mountedRef.current = true;
    const ctrl = new AbortController();
    initialLoadAbortRef.current = ctrl;
    getTemplate(id, ctrl.signal)
      .then((row) => {
        if (!mountedRef.current) return;
        dispatch({ type: "LOAD_OK", row });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        dispatch({ type: "LOAD_ERR", error: err as ApiError });
      });
    return () => {
      mountedRef.current = false;
      ctrl.abort();
      // Abort any in-flight PATCH / pending timer on unmount.
      inFlightAbortRef.current?.abort();
      if (debounceTimerRef.current !== null) clearTimeoutFn(debounceTimerRef.current);
      if (backoffTimerRef.current !== null) clearTimeoutFn(backoffTimerRef.current);
      if (savedTimerRef.current !== null) clearTimeoutFn(savedTimerRef.current);
    };
  }, [id, clearTimeoutFn]);

  // visibilitychange flushes pending saves
  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (pendingPatchRef.current !== null && debounceTimerRef.current !== null) {
          clearTimeoutFn(debounceTimerRef.current);
          debounceTimerRef.current = null;
          flushNow();
        }
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimeoutFn]);

  // ---- inline helpers (closed over refs only — stable) ----

  function flushNow(): void {
    const patch = pendingPatchRef.current;
    if (!patch) {
      // Resolve any forceSave waiter — nothing to do.
      forceSaveResolversRef.current?.resolve();
      forceSaveResolversRef.current = null;
      return;
    }
    inFlightAbortRef.current?.abort();
    const ctrl = new AbortController();
    inFlightAbortRef.current = ctrl;
    if (mountedRef.current) dispatch({ type: "SAVE_START" });
    patchTemplate(id, versionRef.current, { mjml: patch.mjml }, ctrl.signal)
      .then((row) => {
        if (!mountedRef.current) return;
        pendingPatchRef.current = null;
        if (savedTimerRef.current !== null) clearTimeoutFn(savedTimerRef.current);
        savedTimerRef.current = setTimeoutFn(() => {
          if (mountedRef.current) dispatch({ type: "SAVED_TIMEOUT" });
        }, SAVED_INDICATOR_MS);
        dispatch({ type: "PATCH_OK", mjml: patch.mjml, version: row.version });
        forceSaveResolversRef.current?.resolve();
        forceSaveResolversRef.current = null;
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        const apiErr = err instanceof ApiError ? err : null;
        const status = apiErr?.status ?? 0;
        if (status === 404) {
          dispatch({ type: "PATCH_404" });
          forceSaveResolversRef.current?.reject(err);
        } else if (status === 409) {
          dispatch({ type: "PATCH_409" });
          // Refetch then resolve — pending edit was dropped (open Q1 default A).
          void doRefetch().finally(() => {
            forceSaveResolversRef.current?.reject(err);
            forceSaveResolversRef.current = null;
          });
        } else if (status === 412) {
          dispatch({ type: "PATCH_412" });
          forceSaveResolversRef.current?.reject(err);
        } else if (status === 413) {
          dispatch({ type: "PATCH_413" });
          forceSaveResolversRef.current?.reject(err);
        } else if (status === 429) {
          dispatch({ type: "PATCH_429" });
          forceSaveResolversRef.current?.reject(err);
        } else {
          // Network or 5xx → retry backoff
          if (stateRef.current.retryAttempt + 1 >= MAX_ATTEMPTS) {
            dispatch({ type: "GIVE_UP" });
            forceSaveResolversRef.current?.reject(err);
            forceSaveResolversRef.current = null;
            return;
          }
          dispatch({ type: "PATCH_5XX" });
          const delay = BACKOFF_MS[stateRef.current.retryAttempt] ?? 4000;
          backoffTimerRef.current = setTimeoutFn(() => flushNow(), delay);
        }
        if (status === 412 || status === 413 || status === 429 || status === 404) {
          forceSaveResolversRef.current = null;
        }
      });
  }

  async function doRefetch(): Promise<void> {
    try {
      const row = await getTemplate(id);
      if (!mountedRef.current) return;
      versionRef.current = row.version;
      dispatch({ type: "REFETCH_OK", row });
    } catch {
      // swallow — UI shows existing state
    }
  }

  // ---- stable action callbacks ----

  const save = useCallback(
    (nextMjml: string) => {
      pendingPatchRef.current = { mjml: nextMjml };
      dispatch({ type: "DIRTY", mjml: nextMjml });
      if (debounceTimerRef.current !== null) clearTimeoutFn(debounceTimerRef.current);
      debounceTimerRef.current = setTimeoutFn(() => {
        debounceTimerRef.current = null;
        flushNow();
      }, DEBOUNCE_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setTimeoutFn, clearTimeoutFn],
  );

  const forceSave = useCallback((): Promise<void> => {
    if (pendingPatchRef.current === null) return Promise.resolve();
    if (debounceTimerRef.current !== null) {
      clearTimeoutFn(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return new Promise<void>((resolve, reject) => {
      forceSaveResolversRef.current = { resolve, reject };
      flushNow();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimeoutFn]);

  const applyServerWrite = useCallback((mjml: string, version: number) => {
    pendingPatchRef.current = null;
    versionRef.current = version;
    if (debounceTimerRef.current !== null) {
      clearTimeoutFn(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    inFlightAbortRef.current?.abort();
    dispatch({ type: "SERVER_WRITE", mjml, version });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimeoutFn]);

  const cancelPendingSave = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeoutFn(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    inFlightAbortRef.current?.abort();
    inFlightAbortRef.current = null;
    pendingPatchRef.current = null;
    dispatch({ type: "CANCEL_PENDING" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimeoutFn]);

  const refetch = useCallback((): Promise<void> => doRefetch(), []);

  const patchMeta = useCallback((patch: { name?: string; description?: string | null }) => {
    patchTemplate(id, versionRef.current, patch).then((row) => {
      if (!mountedRef.current) return;
      versionRef.current = row.version;
      dispatch({ type: "META_PATCH", row });
    }).catch(() => { /* surfaced via toast in caller; reducer flag deferred */ });
  }, [id]);

  const dismissConflictToast = useCallback(() => dispatch({ type: "DISMISS_CONFLICT" }), []);
  const dismissRateLimitToast = useCallback(() => dispatch({ type: "DISMISS_RATELIMIT" }), []);

  // Strip the internal retryAttempt from public data shape.
  const data: TemplateData = {
    loading: state.loading,
    loadError: state.loadError,
    mjml: state.mjml,
    version: state.version,
    name: state.name,
    description: state.description,
    status: state.status,
    apiKeyMissing: state.apiKeyMissing,
    conflictToast: state.conflictToast,
    rateLimitToast: state.rateLimitToast,
    templateDeleted: state.templateDeleted,
    pendingPatch: state.pendingPatch,
  };

  const actions: TemplateActions = {
    save,
    forceSave,
    applyServerWrite,
    patchMeta,
    cancelPendingSave,
    refetch,
    dismissConflictToast,
    dismissRateLimitToast,
  };

  return { data, actions };
}
