import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import { runQuery } from "../api/templates.js";

const MAX_QUERY_LENGTH = 4_000;

export interface UseQueryRunnerOptions {
  getVersion: () => number;
  onSuccess: (mjml: string, version: number) => void;
  cancelPendingSave: () => void;
  refetch: () => Promise<void>;
}

export interface UseQueryRunnerResult {
  locked: boolean;
  lastReply: string | null;
  error: ApiError | null;
  rateLimited: boolean;
  apiKeyMissing: boolean;
  payloadTooLarge: boolean;
  /** Throws on validation; never throws on server error (those surface via flags). */
  run: (query: string) => Promise<void>;
  abort: () => void;
}

export const QueryRunnerContext = createContext<UseQueryRunnerResult | null>(null);

export function useQueryRunnerCtx(): UseQueryRunnerResult {
  const v = useContext(QueryRunnerContext);
  if (!v) throw new Error("useQueryRunnerCtx must be used inside <TemplateRoute>");
  return v;
}

export function useQueryRunner(id: string, opts: UseQueryRunnerOptions): UseQueryRunnerResult {
  const [locked, setLocked] = useState(false);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [payloadTooLarge, setPayloadTooLarge] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Refs over options so the run callback's identity stays stable across renders.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const run = useCallback(async (query: string): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) throw new Error("query must be a non-empty string");
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(`query exceeds ${MAX_QUERY_LENGTH} characters`);
    }

    // Synchronous cancel BEFORE the POST starts (Architect Synthesis #1).
    // This is the contract that lets us delete `pendingDropRef`/`claudeMidEditToast`
    // from Canvas — the in-flight save is killed first; the post-success
    // applyServerWrite isn't racing anything.
    optsRef.current.cancelPendingSave();

    setError(null);
    setRateLimited(false);
    setApiKeyMissing(false);
    setPayloadTooLarge(false);
    setLocked(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const out = await runQuery(id, optsRef.current.getVersion(), trimmed, ctrl.signal);
      optsRef.current.onSuccess(out.mjml, out.version);
      setLastReply(out.reply);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const apiErr = err instanceof ApiError ? err : null;
      const status = apiErr?.status ?? 0;
      if (status === 412) setApiKeyMissing(true);
      else if (status === 429) setRateLimited(true);
      else if (status === 413) setPayloadTooLarge(true);
      else if (status === 409) {
        await optsRef.current.refetch();
      }
      setError(apiErr ?? new ApiError(0, String(err)));
    } finally {
      setLocked(false);
    }
  }, [id]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    locked,
    lastReply,
    error,
    rateLimited,
    apiKeyMissing,
    payloadTooLarge,
    run,
    abort,
  };
}
