import { useState } from "react";
import { useQueryRunnerCtx } from "../hooks/useQueryRunner.js";

/**
 * Compact prompt input that lives at the bottom of the templates rail.
 * Sends `/query` POSTs; the canvas iframe renders the resulting MJML
 * (no separate reply UI — the canvas IS the reply).
 *
 * Inline error line surfaces validation failures (rate-limit, payload too
 * large, missing API key) since those signals would otherwise be silent.
 */
export function SidebarQueryInput() {
  const q = useQueryRunnerCtx();
  const [text, setText] = useState("");

  const onSend = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    try {
      await q.run(trimmed);
      setText("");
    } catch {
      /* validation errors only — server failures surface via q.* flags */
    }
  };

  const errorMessage =
    q.apiKeyMissing
      ? "ANTHROPIC_API_KEY is not set. See Settings."
      : q.rateLimited
        ? "Rate-limited. Wait a few minutes."
        : q.payloadTooLarge
          ? "Query is too long."
          : null;

  return (
    <div className="sidebar-query-input">
      <textarea
        value={text}
        disabled={q.locked}
        rows={3}
        placeholder="e.g. make the button blue"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void onSend();
          }
        }}
      />
      <button
        type="button"
        onClick={() => void onSend()}
        disabled={q.locked || text.trim() === ""}
      >
        {q.locked ? "Sending…" : "Send"}
      </button>
      {errorMessage && (
        <p className="sidebar-query-error" role="alert">{errorMessage}</p>
      )}
    </div>
  );
}
