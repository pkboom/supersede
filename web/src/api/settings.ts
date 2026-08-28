import { request } from "./client.js";

export interface SettingsRow {
  defaultProvider: string;
  defaultMode: string;
  defaultModel: string;
  apiKeyConfigured: boolean;
}

export function getSettings(signal?: AbortSignal): Promise<SettingsRow> {
  return request<SettingsRow>("/api/settings", { signal });
}

export function patchSettings(
  patch: { defaultModel?: string; defaultMode?: string },
  signal?: AbortSignal,
): Promise<SettingsRow> {
  return request<SettingsRow>("/api/settings", { method: "PATCH", body: patch, signal });
}
