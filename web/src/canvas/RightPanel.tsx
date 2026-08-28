/**
 * RightPanel — tabbed properties panel.
 *
 * Two tabs:
 *   - "Settings": global email-level configuration in three industry-
 *     standard sections (Stripo / Beefree / Mailchimp pattern):
 *       • General — Subject (mj-title), Preheader (mj-preview).
 *       • Layout — Email width (mj-body width), page background
 *         (mj-body background-color).
 *       • Typography Defaults — Default font family
 *         (mj-attributes mj-all font-family), default text color
 *         (mj-attributes mj-text color), default link color
 *         (mj-attributes a color).
 *
 *     Subject/Preheader continue to flow through the indexOf-style
 *     editor in `headEdit.ts`; design defaults flow through the
 *     analogous editor in `mjAttributes.ts`. Email width and page
 *     background bind directly to the new `MjmlDocument.bodyAttrs` Map
 *     captured by the parser/serializer.
 *
 *     The right-panel materializes a synthetic head when `doc.head` is
 *     missing (R9-prime, see headEdit.ts header). The serializer treats
 *     synthetic heads identically to real ones; the `__synthetic`
 *     sentinel is a tree-internal flag.
 *
 *   - "Block":
 *       • Modeled BlockNode → delegates to <PropertiesForm/>.
 *       • CustomPassthroughNode → raw-MJML textarea editor (the only way to
 *         author the inner MJML for Custom MJML / mj-raw / unmodeled tags
 *         the parser captures verbatim).
 *       • UnknownNode (comments, stray text) → empty-state placeholder.
 *
 *     Selecting a block on the canvas auto-switches the panel to "Block"
 *     so the user immediately sees the relevant editor — Stripo / Beefree
 *     convention. Custom MJML drops are auto-selected by Canvas so the
 *     editor opens without a click.
 */
import { useEffect, useState } from "react";
import {
  BLOCK_REGISTRY,
  isBlockNode,
  isCustomPassthroughNode,
  serializeMjml,
} from "../blocks/index.js";
import type {
  BlockNode,
  CustomPassthroughNode,
  MjmlDocument,
  TreeNode,
} from "../blocks/index.js";
import {
  getPreheader,
  getTitle,
  setPreheader,
  setTitle,
} from "@shared/blocks/headEdit.js";
import {
  deleteMjAttribute,
  getMjAttribute,
  setMjAttribute,
} from "@shared/blocks/mjAttributes.js";
import PropertiesForm from "./PropertiesForm.js";

export interface RightPanelProps {
  doc: MjmlDocument | null;
  /** Currently-selected block path; lifted from Canvas-local state. */
  selectedPath: number[] | null;
  /** Notifier — Canvas owns the selection; RightPanel calls this when its
   *  internal "Block" tab needs to clear or change selection. */
  onSelectionChange: (path: number[] | null) => void;
  onCommit: (newSource: string) => void;
}

type Tab = "settings" | "block";

const SUBJECT_RECOMMENDED = 50;
const PREHEADER_RECOMMENDED = 90;

function counterClass(len: number, recommended: number): string {
  if (len > recommended) return "field-counter over";
  if (len > recommended - 5) return "field-counter warn";
  return "field-counter";
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

const FONT_FAMILY_OPTIONS = [
  "Arial, Helvetica, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
  "Trebuchet MS, sans-serif",
  "Georgia, serif",
  "Times New Roman, Times, serif",
  "Courier New, Courier, monospace",
  "Lucida Console, Monaco, monospace",
];

function resolveSelectedNode(
  body: TreeNode[],
  path: number[] | null | undefined
): TreeNode | null {
  if (!path || path.length === 0) return null;
  let arr: TreeNode[] = body;
  let node: TreeNode | undefined;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i]!;
    node = arr[idx];
    if (!node) return null;
    if (i < path.length - 1) {
      if (!isBlockNode(node)) return null;
      arr = node.children ?? [];
    }
  }
  return node ?? null;
}

export default function RightPanel({ doc, selectedPath, onSelectionChange, onCommit }: RightPanelProps) {
  const [tab, setTab] = useState<Tab>("settings");
  // `onSelectionChange` is wired so the legacy "raw-MJML editor wants to
  // close itself" path can call up to Canvas. v2 doesn't currently exercise
  // it from inside the panel; reserved for future block-level UX.
  void onSelectionChange;

  const headRaw = doc?.head?.rawXml ?? "";
  const bodyAttrs = doc?.bodyAttrs;

  // Local controlled state — populated from the doc, flushed on blur.
  // Keeping a local mirror lets the user type without each keystroke
  // re-serializing the entire document.
  const [subjectVal, setSubjectVal] = useState<string>(getTitle(headRaw));
  const [preheaderVal, setPreheaderVal] = useState<string>(
    getPreheader(headRaw)
  );
  const [widthVal, setWidthVal] = useState<string>(
    bodyAttrs?.get("width") ?? ""
  );
  const [pageBgVal, setPageBgVal] = useState<string>(
    bodyAttrs?.get("background-color") ?? ""
  );
  const [fontFamilyVal, setFontFamilyVal] = useState<string>(
    getMjAttribute(headRaw, "mj-all", "font-family")
  );
  const [textColorVal, setTextColorVal] = useState<string>(
    getMjAttribute(headRaw, "mj-text", "color")
  );
  const [linkColorVal, setLinkColorVal] = useState<string>(
    getMjAttribute(headRaw, "a", "color")
  );

  // Re-sync local inputs when `doc` changes externally (e.g. WS update,
  // Claude-side edit). We key on the head's rawXml so a head edit
  // refreshes title/preheader/defaults; bodyAttrs is read separately so
  // a mj-body edit refreshes width/page-bg without churning the others.
  useEffect(() => {
    const raw = doc?.head?.rawXml ?? "";
    setSubjectVal(getTitle(raw));
    setPreheaderVal(getPreheader(raw));
    setFontFamilyVal(getMjAttribute(raw, "mj-all", "font-family"));
    setTextColorVal(getMjAttribute(raw, "mj-text", "color"));
    setLinkColorVal(getMjAttribute(raw, "a", "color"));
  }, [doc?.head?.rawXml]);

  useEffect(() => {
    setWidthVal(doc?.bodyAttrs?.get("width") ?? "");
    setPageBgVal(doc?.bodyAttrs?.get("background-color") ?? "");
  }, [doc?.bodyAttrs]);

  // ---------- Persistence helpers ----------

  const flushHead = (kind: "title" | "preheader", value: string): void => {
    if (!doc) return;
    const existingRaw = doc.head?.rawXml ?? "<mj-head></mj-head>";
    const nextRaw =
      kind === "title"
        ? setTitle(existingRaw, value)
        : setPreheader(existingRaw, value);
    onCommit(serializeMjml(buildDocWithHead(doc, nextRaw)));
  };

  const flushBodyAttr = (name: string, value: string): void => {
    if (!doc) return;
    const next = new Map(doc.bodyAttrs ?? []);
    if (value.trim() === "") {
      next.delete(name);
    } else {
      next.set(name, value);
    }
    onCommit(serializeMjml({ ...doc, bodyAttrs: next }));
  };

  const flushMjAttr = (
    element: string,
    attr: string,
    value: string
  ): void => {
    if (!doc) return;
    const existingRaw = doc.head?.rawXml ?? "<mj-head></mj-head>";
    const nextRaw =
      value.trim() === ""
        ? deleteMjAttribute(existingRaw, element, attr)
        : setMjAttribute(existingRaw, element, attr, value);
    onCommit(serializeMjml(buildDocWithHead(doc, nextRaw)));
  };

  const selectedNode =
    doc && selectedPath ? resolveSelectedNode(doc.body, selectedPath) : null;
  const selectedBlock =
    selectedNode && isBlockNode(selectedNode) ? selectedNode : null;
  const selectedPassthrough =
    selectedNode && isCustomPassthroughNode(selectedNode) ? selectedNode : null;

  // Industry-standard UX: when the user picks a block on the canvas, the panel
  // pivots to the editor for that block. Without this, Custom MJML drops (which
  // auto-select in Canvas) would land the user on the Settings tab and hide
  // the editor they need.
  const selectedKey = selectedPath ? selectedPath.join("/") : "";
  useEffect(() => {
    if (selectedKey !== "") {
      setTab("block");
    }
  }, [selectedKey]);

  return (
    <aside className="right-panel" aria-label="Properties panel">
      <div className="right-panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settings"}
          className={`right-panel-tab ${tab === "settings" ? "active" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "block"}
          className={`right-panel-tab ${tab === "block" ? "active" : ""}`}
          onClick={() => setTab("block")}
        >
          Block
        </button>
      </div>

      {tab === "settings" ? (
        <div className="right-panel-section" data-tab="settings">
          {/* General ----------------------------------------------------- */}
          <div className="settings-group">
            <div className="settings-group-title">General</div>

            <label>
              <span>Subject</span>
              <span
                className={counterClass(
                  subjectVal.length,
                  SUBJECT_RECOMMENDED
                )}
              >
                {subjectVal.length} / {SUBJECT_RECOMMENDED}
              </span>
              <input
                type="text"
                value={subjectVal}
                onChange={(e) => setSubjectVal(e.target.value)}
                onBlur={(e) => flushHead("title", e.target.value)}
                disabled={!doc}
                placeholder="Your weekly newsletter is here"
                maxLength={200}
              />
              <div className="field-help">
                Stored as <code>&lt;mj-title&gt;</code>. Many email clients
                use this as the HTML page title; keep it under{" "}
                {SUBJECT_RECOMMENDED} characters so it isn't truncated.
              </div>
            </label>

            <label>
              <span>Preheader</span>
              <span
                className={counterClass(
                  preheaderVal.length,
                  PREHEADER_RECOMMENDED
                )}
              >
                {preheaderVal.length} / {PREHEADER_RECOMMENDED}
              </span>
              <input
                type="text"
                value={preheaderVal}
                onChange={(e) => setPreheaderVal(e.target.value)}
                onBlur={(e) => flushHead("preheader", e.target.value)}
                disabled={!doc}
                placeholder="A short summary shown alongside the email title"
                maxLength={200}
              />
              <div className="field-help">
                Stored as <code>&lt;mj-preview&gt;</code>. The first ~
                {PREHEADER_RECOMMENDED} characters appear next to the email
                title in most inboxes.
              </div>
            </label>
          </div>

          {/* Layout ------------------------------------------------------ */}
          <div className="settings-group">
            <div className="settings-group-title">Layout</div>

            <label>
              <span>Email width</span>
              <input
                type="text"
                value={widthVal}
                onChange={(e) => setWidthVal(e.target.value)}
                onBlur={(e) => flushBodyAttr("width", e.target.value)}
                disabled={!doc}
                placeholder="600px"
              />
              <div className="field-help">
                Content area width on `mj-body`. Email best practice is{" "}
                <code>600px</code>; <code>100%</code> renders full-width.
              </div>
            </label>

            <label>
              <span>Page background</span>
              <div className="field-color-row">
                <input
                  type="color"
                  className="field-color-swatch"
                  value={isHexColor(pageBgVal) ? pageBgVal : "#ffffff"}
                  onChange={(e) => {
                    setPageBgVal(e.target.value);
                    flushBodyAttr("background-color", e.target.value);
                  }}
                  disabled={!doc}
                  aria-label="Page background color picker"
                />
                <input
                  type="text"
                  value={pageBgVal}
                  onChange={(e) => setPageBgVal(e.target.value)}
                  onBlur={(e) =>
                    flushBodyAttr("background-color", e.target.value)
                  }
                  disabled={!doc}
                  placeholder="#ffffff"
                />
              </div>
              <div className="field-help">
                Color of the area outside the email content (the inbox
                viewport when the email isn't full-width).
              </div>
            </label>
          </div>

          {/* Typography Defaults ----------------------------------------- */}
          <div className="settings-group">
            <div className="settings-group-title">Typography defaults</div>

            <label>
              <span>Default font family</span>
              <select
                value={
                  fontFamilyVal === "" ||
                  FONT_FAMILY_OPTIONS.includes(fontFamilyVal)
                    ? fontFamilyVal
                    : "__custom__"
                }
                onChange={(e) => {
                  if (e.target.value === "__custom__") return;
                  setFontFamilyVal(e.target.value);
                  flushMjAttr("mj-all", "font-family", e.target.value);
                }}
                disabled={!doc}
              >
                <option value="">— Use client default —</option>
                {FONT_FAMILY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.split(",")[0]}
                  </option>
                ))}
                {fontFamilyVal !== "" &&
                !FONT_FAMILY_OPTIONS.includes(fontFamilyVal) ? (
                  <option value="__custom__">{fontFamilyVal} (custom)</option>
                ) : null}
              </select>
              <div className="field-help">
                Applied to every block via{" "}
                <code>&lt;mj-attributes&gt;&lt;mj-all&gt;</code>. Stick to
                email-safe stacks; custom web fonts need a separate{" "}
                <code>mj-font</code> declaration.
              </div>
            </label>

            <label>
              <span>Default text color</span>
              <div className="field-color-row">
                <input
                  type="color"
                  className="field-color-swatch"
                  value={isHexColor(textColorVal) ? textColorVal : "#000000"}
                  onChange={(e) => {
                    setTextColorVal(e.target.value);
                    flushMjAttr("mj-text", "color", e.target.value);
                  }}
                  disabled={!doc}
                  aria-label="Default text color picker"
                />
                <input
                  type="text"
                  value={textColorVal}
                  onChange={(e) => setTextColorVal(e.target.value)}
                  onBlur={(e) =>
                    flushMjAttr("mj-text", "color", e.target.value)
                  }
                  disabled={!doc}
                  placeholder="#333333"
                />
              </div>
              <div className="field-help">
                Default <code>color</code> on every <code>mj-text</code>.
              </div>
            </label>

            <label>
              <span>Default link color</span>
              <div className="field-color-row">
                <input
                  type="color"
                  className="field-color-swatch"
                  value={isHexColor(linkColorVal) ? linkColorVal : "#1f6feb"}
                  onChange={(e) => {
                    setLinkColorVal(e.target.value);
                    flushMjAttr("a", "color", e.target.value);
                  }}
                  disabled={!doc}
                  aria-label="Default link color picker"
                />
                <input
                  type="text"
                  value={linkColorVal}
                  onChange={(e) => setLinkColorVal(e.target.value)}
                  onBlur={(e) => flushMjAttr("a", "color", e.target.value)}
                  disabled={!doc}
                  placeholder="#1f6feb"
                />
              </div>
              <div className="field-help">
                Applied to <code>&lt;a&gt;</code> tags inside text blocks via
                <code>&lt;mj-attributes&gt;&lt;a&gt;</code>.
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="right-panel-section" data-tab="block">
          {selectedBlock && doc ? (
            <>
              <div className="right-panel-block-header">
                {BLOCK_REGISTRY[selectedBlock.type]?.label ?? selectedBlock.type}
                <span className="right-panel-block-header-tag">
                  {selectedBlock.type}
                </span>
              </div>
              <PropertiesForm
                node={selectedBlock}
                doc={doc}
                onCommit={onCommit}
              />
            </>
          ) : selectedPassthrough && doc && selectedPath ? (
            <>
              <div className="right-panel-block-header">
                {BLOCK_REGISTRY["mj-custom-passthrough"].label}
                <span className="right-panel-block-header-tag">
                  {selectedPassthrough.originalTagName ||
                    "mj-custom-passthrough"}
                </span>
              </div>
              <CustomPassthroughEditor
                node={selectedPassthrough}
                path={selectedPath}
                doc={doc}
                onCommit={onCommit}
              />
            </>
          ) : (
            <div className="right-panel-empty">
              Select a block on the canvas to edit its properties.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * Build a new `MjmlDocument` with `head.rawXml` replaced by `nextRaw`.
 * Preserves the `__synthetic` flag if present, or stamps it on when the
 * source had no head at all (R9-prime materialization).
 */
function buildDocWithHead(doc: MjmlDocument, nextRaw: string): MjmlDocument {
  const synthetic = doc.head === undefined ? true : doc.head.__synthetic;
  return {
    ...doc,
    head: synthetic
      ? { rawXml: nextRaw, __synthetic: true }
      : { rawXml: nextRaw },
  };
}

/**
 * Editor for `CustomPassthroughNode.rawXml` — a textarea backed by a copy of
 * the verbatim slice the parser captured. On flush we splice a clone of the
 * doc body where the node at `path` has its `rawXml` replaced, then re-emit.
 *
 * The textarea is the ONLY surface for editing arbitrary MJML the parser
 * cannot model (mj-raw, mj-wrapper, mj-style, custom tags) — by design no
 * structured form exists, since the content is opaque.
 */
interface CustomPassthroughEditorProps {
  node: CustomPassthroughNode;
  path: number[];
  doc: MjmlDocument;
  onCommit: (newSource: string) => void;
}

function CustomPassthroughEditor({
  node,
  path,
  doc,
  onCommit,
}: CustomPassthroughEditorProps) {
  const [value, setValue] = useState<string>(node.rawXml);

  // Re-sync from the doc when the node identity changes (selection moves to a
  // different passthrough, or the node is rewritten by Claude).
  useEffect(() => {
    setValue(node.rawXml);
  }, [node.id, node.rawXml]);

  const flush = (next: string): void => {
    if (next === node.rawXml) return;
    const cloned = structuredClone(doc.body) as TreeNode[];
    const target = walkToNode(cloned, path);
    if (!target || !isCustomPassthroughNode(target)) return;
    target.rawXml = next;
    onCommit(serializeMjml({ ...doc, body: cloned }));
  };

  return (
    <div className="right-panel-form" data-block-type="mj-custom-passthrough">
      <label data-attr="raw-mjml">
        <span className="field-key">raw MJML</span>
        <span className="field-label-text">Raw MJML / HTML</span>
        <textarea
          rows={10}
          spellCheck={false}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "12px",
            lineHeight: 1.45,
            resize: "vertical",
          }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => flush(e.target.value)}
          placeholder='<mj-raw><div>...</div></mj-raw>'
        />
        <div className="field-help">
          Anything the visual editor can't model lives here verbatim — wrap raw
          HTML in <code>&lt;mj-raw&gt;</code>, or paste a custom MJML tag like{" "}
          <code>&lt;mj-wrapper&gt;</code>. Changes flush on blur.
        </div>
      </label>
    </div>
  );
}

function walkToNode(body: TreeNode[], path: number[]): TreeNode | null {
  if (path.length === 0) return null;
  let arr: TreeNode[] = body;
  let node: TreeNode | undefined;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i]!;
    node = arr[idx];
    if (!node) return null;
    if (i < path.length - 1) {
      if (!isBlockNode(node)) return null;
      arr = node.children ?? [];
    }
  }
  return node ?? null;
}
