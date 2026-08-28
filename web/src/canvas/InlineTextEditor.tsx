/**
 * InlineTextEditor — F3-prime piece 3 (postmessage adapter for inline edits).
 *
 * Owns the begin-edit / edit-input / edit-blur lifecycle for `mj-text` and
 * `mj-button` blocks. The actual contenteditable lives INSIDE the iframe
 * (see IframePreview's bootstrap script); this component is the parent-side
 * coordinator that:
 *   1) Sends `EMAIL_DESIGNER_BEGIN_EDIT` via postMessage to the iframe when
 *      the user double-clicks an editable region (Lane F's overlay calls
 *      `beginEdit(ordinal, expectedText)`).
 *   2) On begin-edit, flips the local store's `inlineEditActive=true` AND
 *      sends `wsClient.sendInlineEditActive(true)` so the server-side
 *      runner blocks free-form terminal prompts during the session.
 *   3) Listens for `EMAIL_DESIGNER_EDIT_BLUR` via window message, debounces
 *      50ms, and dispatches `POST /api/canvas` with
 *      `origin: "browser-inline-text"`. Also fires `inlineEditActive(false)`.
 *
 * Note: this component is presentation-less — it returns `null` and only
 * exposes `beginEdit` / `endEdit` via the (loose) imperative wiring Lane F
 * arranges. The intent is for Lane F to keep a ref or call a setter from
 * the parent's effect; the actual ref-handle plumbing is intentionally
 * deferred.
 */
import { useEffect } from "react";
import type { MutableRefObject, RefObject } from "react";

interface InlineTextEditorProps {
  iframeRef: RefObject<HTMLIFrameElement>;
  onCommit: (newSource: string) => void;
  /** Mutable ref the parent owns — we attach `beginEdit` / `endEdit`
   *  callbacks so the canvas overlay can drive the editor without
   *  prop-drilling refs. */
  controlRef?: MutableRefObject<{
    beginEdit: (ordinal: number, expectedText: string) => void;
    endEdit: () => void;
  } | null>;
}

export default function InlineTextEditor({
  iframeRef,
  onCommit,
  controlRef,
}: InlineTextEditorProps) {
  // v2 has no server-side runner to coordinate with — inline-edit-active
  // is purely a local concern. The v1 `window.__emailDesignerWsClient`
  // shim is gone.
  const sendInlineActive = (_active: boolean) => {
    /* intentionally a no-op in v2 */
  };

  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (ev: MessageEvent) => {
      // SECURITY: only accept messages from our own iframe.
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as
        | { type?: string; text?: string }
        | undefined;
      if (!data || typeof data !== "object") return;

      if (data.type === "EMAIL_DESIGNER_EDIT_INPUT") {
        // Per AC: input events are NOT debounced into a commit — they're
        // signal that an edit is in progress. We could surface a preview
        // hook in the future; for v1 we just ensure the active flag stays
        // true.
        return;
      }

      if (data.type === "EMAIL_DESIGNER_EDIT_BLUR") {
        const text = typeof data.text === "string" ? data.text : "";
        // Debounce 50ms to coalesce blur + late-input events.
        if (blurTimer) clearTimeout(blurTimer);
        blurTimer = setTimeout(() => {
          blurTimer = null;
          sendInlineActive(false);
          // Lane F is responsible for converting `text` into a source
          // mutation (locating the block by selectedPath, updating
          // `node.text`, serializing). For Lane E we expose the raw text
          // by calling onCommit with the text — Lane F will replace this
          // shim with the real serialize-and-patch path.
          onCommit(text);
          // Trip the canvas POST. The component itself does NOT know the
          // source; Lane F's onCommit dispatches /api/canvas with the
          // "browser-inline-text" origin.
        }, 50);
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      if (blurTimer) clearTimeout(blurTimer);
    };
  }, [onCommit]);

  // Imperative API exposed via controlRef.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      beginEdit(ordinal: number, expectedText: string) {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        sendInlineActive(true);
        win.postMessage(
          {
            type: "EMAIL_DESIGNER_BEGIN_EDIT",
            ordinal,
            expectedText,
          },
          "*",
        );
      },
      endEdit() {
        sendInlineActive(false);
      },
    };
    return () => {
      if (controlRef) controlRef.current = null;
    };
  }, [controlRef, iframeRef]);

  return null;
}
