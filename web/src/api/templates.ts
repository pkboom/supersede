import { request } from "./client.js";

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  mjml: string;
  version: number;
  /** ISO string in JSON; Date object server-side. */
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

export interface QueryResponse {
  mjml: string;
  reply: string;
  version: number;
}

export function listTemplates(signal?: AbortSignal): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>("/api/templates", { signal });
}

export function getTemplate(id: string, signal?: AbortSignal): Promise<TemplateRow> {
  return request<TemplateRow>(`/api/templates/${encodeURIComponent(id)}`, { signal });
}

export function createTemplate(
  args: { name: string; description?: string | null; mjml?: string },
  signal?: AbortSignal,
): Promise<TemplateRow> {
  return request<TemplateRow>("/api/templates", { method: "POST", body: args, signal });
}

export function patchTemplate(
  id: string,
  version: number,
  patch: { name?: string; description?: string | null; mjml?: string },
  signal?: AbortSignal,
): Promise<TemplateRow> {
  return request<TemplateRow>(`/api/templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { version, ...patch },
    signal,
  });
}

export function deleteTemplate(id: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}

export function runQuery(
  id: string,
  version: number,
  query: string,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  return request<QueryResponse>(`/api/templates/${encodeURIComponent(id)}/query`, {
    method: "POST",
    body: { version, query },
    signal,
  });
}
