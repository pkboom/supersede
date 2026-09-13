/**
 * IframePreview — F3-prime piece 1 (single-iframe canvas + bbox bus).
 *
 * Renders ONE sandboxed `<iframe>` containing the rendered email HTML, plus
 * a bootstrap `<script>` injected at the END of `<body>` that:
 *   1) Walks every element with a `data-mjml-path` attribute (stamped by the
 *      server-side `stampMjmlPaths` helper) and posts one
 *      `EMAIL_DESIGNER_REPORT_BBOX` message per element keyed by `pathKey:
 *      string` (parser-format, e.g. "0/0/1"). The message also carries
 *      `scrollX/scrollY` of the iframe content so the parent can transform
 *      iframe-viewport coords back to page coords (H1).
 *   2) Attaches `addEventListener('load', reemit)` to every `<img>` so
 *      late-loading images re-emit bboxes after layout shifts.
 *   3) Installs a `ResizeObserver` on `<body>` (debounced 50ms) to re-emit
 *      bboxes AND post `EMAIL_DESIGNER_REPORT_HEIGHT` so the parent can size
 *      the iframe to the body's content height (H2).
 *   4) Listens for parent → iframe `EMAIL_DESIGNER_BEGIN_EDIT` messages,
 *      finds the Nth (`ordinal`) element whose textContent matches
 *      `expectedText`, applies `contenteditable=true`, focuses, and posts
 *      back `EMAIL_DESIGNER_EDIT_INPUT` on `input` / `EMAIL_DESIGNER_EDIT_BLUR`
 *      on blur.
 *   5) Listens for parent → iframe `EMAIL_DESIGNER_REQUEST_REEMIT` messages
 *      (parent posts on window resize / `.canvas-main` scroll) and re-emits
 *      bboxes + content height (H1).
 *   6) Listens for the iframe-internal `scroll` event and re-emits bboxes so
 *      page→viewport coord deltas track scroll position (H1, §2.3.1).
 *
 * **CRITICAL ordering invariant**: The window-level `message` listener for
 * `EMAIL_DESIGNER_REPORT_BBOX` MUST be installed BEFORE `iframe.srcdoc` is
 * (re)assigned. We achieve this by splitting the work across two effects:
 *   - Effect A (deps: []) runs once on mount and installs the listener.
 *   - Effect B (deps: [source, currentRevision]) does the /api/render fetch
 *     and assigns `srcdoc` only after the listener is in place.
 * React commits effects in declaration order, and the empty-deps effect
 * commits BEFORE the source-deps effect on first render. On subsequent
 * renders the listener is already installed (it's a permanent global) so
 * srcdoc updates land correctly.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface IframePreviewProps {
  source: string;
  currentRevision: number;
  viewportMode: "desktop" | "mobile";
  /**
   * Called once per stamped block per re-emit cycle. `pathKey` is the
   * parser-format string (e.g. "0/0/1"). `iframeScroll` is the iframe content
   * window's scroll position at emit time — used by the parent to translate
   * `rect` (which is in iframe-viewport coords) back to page coords.
   */
  onBboxReport: (
    pathKey: string,
    rect: Rect,
    iframeScroll: { x: number; y: number }
  ) => void;
  onEditInput?: (text: string) => void;
  onEditBlur?: (text: string) => void;
  /**
   * When true, the iframe is made transparent to pointer events. The sandboxed
   * cross-origin iframe otherwise swallows pointer capture during a drag,
   * which kills dnd-kit's pointer tracking and prevents drops from landing.
   */
  passThroughPointerEvents?: boolean;
}

const VIEWPORT_WIDTH: Record<"desktop" | "mobile", number> = {
  desktop: 600,
  mobile: 320,
};

/**
 * Iframe height floor. Matches the `min-height: 320px` on `.canvas-frame`
 * and on the iframe inline style — keeps a short / empty render visible.
 */
const MIN_IFRAME_HEIGHT = 320;

/**
 * The bootstrap script body. Runs INSIDE the iframe. Plain JS, no imports.
 * We embed it as a literal string and append it to the end of `<body>` in
 * the rendered srcDoc.
 *
 * Path computation v2 (H3): the server-side `stampMjmlPaths` helper has
 * stamped `data-mjml-path="0/0/1"` on every modeled-block container. The
 * bootstrap reads this attribute directly — no DOM-walk-based heuristic.
 */
const BOOTSTRAP_SCRIPT = `
(function () {
  var REEMIT_DEBOUNCE = 50;
  var debounceTimer = null;

  // Empty <mj-column> elements collapse to height 0 in rendered MJML (their
  // inner <tbody> has no rows), so the bbox-driven overlay can't surface them
  // as click / drop targets. Apply an editor-only inline min-height + dashed
  // outline so the user sees the empty column as a usable drop zone. This
  // mutates only the iframe DOM — exports go through /api/export which
  // re-renders from source, so the affordance never leaks into delivered email.
  function inflateEmptyColumns() {
    var cols = document.querySelectorAll('div[data-mjml-path][class*="mj-column-"]');
    for (var i = 0; i < cols.length; i++) {
      var el = cols[i];
      var rect = el.getBoundingClientRect();
      if (rect.height < 1 && rect.width > 0) {
        el.style.minHeight = '40px';
        el.style.outline = '1px dashed rgba(139, 92, 246, 0.4)';
        el.style.outlineOffset = '-2px';
        el.style.boxSizing = 'border-box';
      }
    }
  }

  function emitBboxes() {
    var els = document.querySelectorAll('[data-mjml-path]');
    var sx = window.scrollX || window.pageXOffset || 0;
    var sy = window.scrollY || window.pageYOffset || 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var rect = el.getBoundingClientRect();
      // Skip zero-size elements (mjml emits scaffolding tds).
      if (rect.width === 0 && rect.height === 0) continue;
      var pathKey = el.getAttribute('data-mjml-path') || '';
      if (!pathKey) continue;
      window.parent.postMessage({
        type: 'EMAIL_DESIGNER_REPORT_BBOX',
        pathKey: pathKey,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        scrollX: sx,
        scrollY: sy
      }, '*');
    }
  }

  function emitContentHeight() {
    var h = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
      0
    );
    window.parent.postMessage({
      type: 'EMAIL_DESIGNER_REPORT_HEIGHT',
      height: h
    }, '*');
  }

  function scheduleReemit() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      inflateEmptyColumns();
      emitBboxes();
      emitContentHeight();
    }, REEMIT_DEBOUNCE);
  }

  // Editor-only stylesheet injected on init. Strips the browser's default
  // blue focus ring on \`contenteditable\` (industry-standard email
  // builders rely on the parent overlay's purple selection box for
  // edit-state feedback) and provides a brand-tinted caret. Scoped via a
  // \`data-email-designer-editor\` attribute so the export pipeline (which
  // re-renders from source) can never carry these styles into delivered
  // email — but defensively, mj-build re-renders ignore live DOM anyway.
  function injectEditorStyles() {
    if (document.getElementById('email-designer-editor-styles')) return;
    var style = document.createElement('style');
    style.id = 'email-designer-editor-styles';
    style.textContent =
      '[contenteditable="true"]:focus,' +
      '[contenteditable="true"]:focus-visible {' +
        'outline: none !important;' +
        'box-shadow: none !important;' +
      '}' +
      '[contenteditable="true"] {' +
        'caret-color: #8b5cf6;' +
      '}';
    if (document.head) {
      document.head.appendChild(style);
    } else if (document.body) {
      document.body.appendChild(style);
    }
  }

  function init() {
    injectEditorStyles();
    inflateEmptyColumns();
    emitBboxes();
    emitContentHeight();

    // Re-emit on every <img> load (late-arriving layout shifts).
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener('load', scheduleReemit);
    }

    // Re-emit on any layout reflow inside the iframe.
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      var ro = new ResizeObserver(scheduleReemit);
      ro.observe(document.body);
    }

    // Iframe-internal scroll: re-emit bboxes (rect.x/y are viewport-relative,
    // so a scroll inside the iframe shifts them) — H1 §2.3.1.
    window.addEventListener('scroll', scheduleReemit, { passive: true });
    window.addEventListener('resize', scheduleReemit, { passive: true });

    // Edit lifecycle + REQUEST_REEMIT: parent → iframe message channel.
    window.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'EMAIL_DESIGNER_REQUEST_REEMIT') {
        // Coalesced re-emit: bboxes + height piggybacked. (H1 + H2.)
        scheduleReemit();
        return;
      }

      if (data.type !== 'EMAIL_DESIGNER_BEGIN_EDIT') return;
      var ordinal = typeof data.ordinal === 'number' ? data.ordinal : 0;
      var expected = typeof data.expectedText === 'string' ? data.expectedText : '';
      // Find the Nth element whose textContent (trimmed) equals expected.
      var all = document.querySelectorAll('*');
      var matchIdx = 0;
      var target = null;
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        // Only consider leaf-like text containers — skip elements that have
        // element children (prevents matching <td> wrappers when we want
        // the inner span/div).
        if (el.children.length > 0) continue;
        var text = (el.textContent || '').trim();
        if (text === expected.trim() && expected.trim().length > 0) {
          if (matchIdx === ordinal) {
            target = el;
            break;
          }
          matchIdx++;
        }
      }
      if (!target) return;
      target.setAttribute('contenteditable', 'true');
      target.focus();
      target.addEventListener('input', function () {
        window.parent.postMessage({
          type: 'EMAIL_DESIGNER_EDIT_INPUT',
          text: target.textContent || ''
        }, '*');
      });
      target.addEventListener('blur', function () {
        window.parent.postMessage({
          type: 'EMAIL_DESIGNER_EDIT_BLUR',
          text: target.textContent || ''
        }, '*');
        target.removeAttribute('contenteditable');
      }, { once: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

interface RenderResponse {
  html?: string;
  error?: string;
  /**
   * Path keys the stamper could not match to a rendered element, so the canvas
   * cannot make those blocks selectable (plan §0.5). Previously the server
   * spent this on a `console.warn` and discarded it, which left the browser
   * structurally blind — it could not know that blocks were unselectable, so
   * the failure surfaced as "selection mysteriously stopped working".
   *
   * Surfacing this in the canvas UI is deferred with the rest of §8; the field
   * is returned now so the affordance has data to render, and so the deferred
   * mjml 4->5 bump (§0.4) has a smoke alarm.
   *
   * Note the limit: completeness, not correctness. It cannot catch
   * mis-targeting that still counts stamped === expected.
   */
  unstamped?: string[];
}

function IframePreviewInner(
  {
    source,
    currentRevision,
    viewportMode,
    onBboxReport,
    onEditInput,
    onEditBlur,
    passThroughPointerEvents,
  }: IframePreviewProps,
  forwardedRef: React.ForwardedRef<HTMLIFrameElement>
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Expose the underlying iframe element to the parent so the inline-edit
  // postMessage flow can target `iframe.contentWindow` directly. We ALSO
  // keep the internal `iframeRef` for srcdoc/source-validation purposes.
  useImperativeHandle(forwardedRef, () => iframeRef.current as HTMLIFrameElement, []);
  // Hold the latest callback refs so the once-on-mount listener always sees
  // the current handlers without re-installing itself on every render.
  const onBboxRef = useRef(onBboxReport);
  const onEditInputRef = useRef(onEditInput);
  const onEditBlurRef = useRef(onEditBlur);
  useEffect(() => {
    onBboxRef.current = onBboxReport;
  }, [onBboxReport]);
  useEffect(() => {
    onEditInputRef.current = onEditInput;
  }, [onEditInput]);
  useEffect(() => {
    onEditBlurRef.current = onEditBlur;
  }, [onEditBlur]);

  // ---- Effect A: install the parent-side message listener ONCE on mount.
  // This effect MUST commit before Effect B (the srcdoc assigner) below —
  // React guarantees declaration-order effect commit, and an empty-deps
  // effect commits on first render before any source-deps effect.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      // SECURITY: only accept messages from our own iframe. Without this,
      // any other window (popup, sibling iframe) can forge
      // EMAIL_DESIGNER_* messages.
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as
        | {
            type?: string;
            pathKey?: string;
            rect?: Rect;
            scrollX?: number;
            scrollY?: number;
            text?: string;
            height?: number;
          }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (
        data.type === "EMAIL_DESIGNER_REPORT_BBOX" &&
        typeof data.pathKey === "string" &&
        data.rect
      ) {
        onBboxRef.current(data.pathKey, data.rect, {
          x: typeof data.scrollX === "number" ? data.scrollX : 0,
          y: typeof data.scrollY === "number" ? data.scrollY : 0,
        });
        return;
      }
      // H2 — iframe content-height report. Hysteresis (> 2px) prevents
      // sub-pixel oscillation under WebKit's bounding-rect rounding. Always
      // floor to MIN_IFRAME_HEIGHT so a short/empty render still shows.
      if (
        data.type === "EMAIL_DESIGNER_REPORT_HEIGHT" &&
        typeof data.height === "number"
      ) {
        const next = Math.max(data.height, MIN_IFRAME_HEIGHT);
        const cur = iframeRef.current?.clientHeight ?? 0;
        if (Math.abs(next - cur) > 2 && iframeRef.current) {
          iframeRef.current.style.height = next + "px";
        }
        return;
      }
      if (
        data.type === "EMAIL_DESIGNER_EDIT_INPUT" &&
        typeof data.text === "string"
      ) {
        onEditInputRef.current?.(data.text);
        return;
      }
      if (
        data.type === "EMAIL_DESIGNER_EDIT_BLUR" &&
        typeof data.text === "string"
      ) {
        onEditBlurRef.current?.(data.text);
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ---- Effect B: render via /api/render, then assign srcdoc.
  // Runs after Effect A on first render (declaration order) so the listener
  // is in place before any iframe message can arrive.
  useEffect(() => {
    let cancelled = false;
    if (!source) {
      if (iframeRef.current) iframeRef.current.srcdoc = "";
      return;
    }
    fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    })
      .then((r) => r.json())
      .then((data: RenderResponse) => {
        if (cancelled) return;
        if (data.error || !data.html) {
          if (iframeRef.current) iframeRef.current.srcdoc = "";
          return;
        }
        // Inject bootstrap script at end of body. If body close tag is
        // missing (degenerate render), append the script + a closing tag.
        const bootstrap = `<script>${BOOTSTRAP_SCRIPT}<\/script>`;
        const closeIdx = data.html.lastIndexOf("</body>");
        const composed =
          closeIdx >= 0
            ? data.html.slice(0, closeIdx) + bootstrap + data.html.slice(closeIdx)
            : data.html + bootstrap;
        if (iframeRef.current) {
          iframeRef.current.srcdoc = composed;
        }
      })
      .catch(() => {
        // Swallow — Lane F decides if a banner is appropriate. Source-only
        // errors here shouldn't crash the canvas.
      });
    return () => {
      cancelled = true;
    };
  }, [source, currentRevision]);

  return (
    <iframe
      ref={iframeRef}
      className="iframe-preview"
      title="email-canvas"
      // SECURITY: NO `allow-same-origin`. The rendered email body comes from
      // user/Claude-controlled MJML; same-origin would expose parent cookies,
      // localStorage, and `window.parent.*` to any injected `<script>`.
      // postMessage works cross-origin so the bbox/inline-edit flow keeps
      // working with `null` origin.
      sandbox="allow-scripts"
      // Suppress the iframe's own scrollbar — the bootstrap script keeps the
      // element height in sync with body.scrollHeight, but the height handler
      // has a ±2px deadband, so subpixel rounding can leave the body 1-2px
      // taller than the box. Chrome paints a vertical gutter for that, which
      // appears as a thin "line" near the right edge of the canvas.
      scrolling="no"
      style={{
        width: VIEWPORT_WIDTH[viewportMode],
        maxWidth: "100%",
        height: "100%",
        minHeight: MIN_IFRAME_HEIGHT,
        border: "none",
        pointerEvents: passThroughPointerEvents ? "none" : undefined,
      }}
    />
  );
}

const IframePreview = forwardRef<HTMLIFrameElement, IframePreviewProps>(
  IframePreviewInner
);
IframePreview.displayName = "IframePreview";
export default IframePreview;
