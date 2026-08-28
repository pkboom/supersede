import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import { type SettingsRow, getSettings, patchSettings } from "../api/settings.js";

export interface UseSettingsResult {
  loading: boolean;
  defaultProvider: string;
  defaultMode: string;
  defaultModel: string;
  apiKeyConfigured: boolean;
  /**
   * Optimistic-update PATCH. Resolves on 200; rejects on 400 (caller should
   * leave its `<select>` bound to `defaultModel` so the revert is automatic).
   */
  setDefaultModel: (model: string) => Promise<void>;
  setDefaultMode: (mode: string) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [row, setRow] = useState<SettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ctrl = new AbortController();
    getSettings(ctrl.signal)
      .then((r) => {
        if (!mountedRef.current) return;
        setRow(r);
        setLoading(false);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        // On error, leave row null and loading=false so the component can render a fallback.
        setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      ctrl.abort();
    };
  }, []);

  const setDefaultModel = useCallback(async (model: string): Promise<void> => {
    const previous = row;
    // Optimistic update first.
    if (row) setRow({ ...row, defaultModel: model });
    try {
      const updated = await patchSettings({ defaultModel: model });
      if (!mountedRef.current) return;
      setRow(updated);
    } catch (err) {
      // Revert.
      if (mountedRef.current && previous) setRow(previous);
      throw err instanceof ApiError ? err : new ApiError(0, String(err));
    }
  }, [row]);

  const setDefaultMode = useCallback(async (mode: string): Promise<void> => {
    const previous = row;
    if (row) setRow({ ...row, defaultMode: mode });
    try {
      const updated = await patchSettings({ defaultMode: mode });
      if (!mountedRef.current) return;
      setRow(updated);
    } catch (err) {
      if (mountedRef.current && previous) setRow(previous);
      throw err instanceof ApiError ? err : new ApiError(0, String(err));
    }
  }, [row]);

  return {
    loading,
    defaultProvider: row?.defaultProvider ?? "anthropic",
    defaultMode: row?.defaultMode ?? "cli",
    defaultModel: row?.defaultModel ?? "claude-opus-4-7",
    apiKeyConfigured: row?.apiKeyConfigured ?? false,
    setDefaultModel,
    setDefaultMode,
  };
}
