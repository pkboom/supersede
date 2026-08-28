/**
 * PropertiesForm — registry-driven attribute form, organized in the
 * industry-standard "grouped categories with type-specific controls"
 * pattern (Stripo / Beefree / Mailchimp / Webflow):
 *
 *  - Attributes are bucketed into Content / Layout / Typography /
 *    Background / Border / Other and rendered under headed sub-groups.
 *  - Color attrs (`color`, `*-color`) render a native color picker
 *    paired with a hex text input — both bound to the same value.
 *  - `align` renders a segmented Left / Center / Right control.
 *  - Known enums (`font-weight`, `font-family`, `mode`) render as
 *    `<select>` dropdowns with sensible defaults.
 *  - All other attrs fall back to text input. `mj-image src` keeps its
 *    URL input + stub file picker (multipart upload pipeline TBD).
 *
 * Read/write goes through `getAttr` / `setAttr` from `attrsHelpers.ts` so
 * insertion order is preserved on update (existing keys keep their index;
 * new keys append). Color pickers and selects flush on change; text-style
 * inputs flush on blur. The `<span>{key}</span>` is intentionally retained
 * inside each `<label>` (as a small mono subtitle) so existing parameterized
 * tests can still locate the input via `queryByText(key)` →
 * `parentElement.querySelector("input")`.
 *
 * Attributes outside `BLOCK_REGISTRY[type].allowedAttrs` are PRESERVED in
 * the block's insertion-ordered `attrs` Map (A-prime contract) but are
 * surfaced only as a small "N attrs preserved" subtitle.
 */
import { useMemo, useState } from "react";
import {
  BLOCK_REGISTRY,
  getAttr,
  setAttr,
  serializeMjml,
} from "../blocks/index.js";
import type { BlockNode, MjmlDocument } from "../blocks/index.js";

interface PropertiesFormProps {
  node: BlockNode;
  doc: MjmlDocument;
  onCommit: (newSource: string) => void;
}

type Category =
  | "Content"
  | "Layout"
  | "Typography"
  | "Background"
  | "Border"
  | "Other";

const ATTR_CATEGORY: Record<string, Category> = {
  src: "Content",
  alt: "Content",
  href: "Content",
  width: "Layout",
  height: "Layout",
  align: "Layout",
  padding: "Layout",
  mode: "Layout",
  "icon-size": "Layout",
  "font-size": "Typography",
  "font-weight": "Typography",
  "font-family": "Typography",
  "line-height": "Typography",
  color: "Typography",
  "background-color": "Background",
  "background-url": "Background",
  border: "Border",
  "border-color": "Border",
  "border-width": "Border",
  "border-radius": "Border",
};

const CATEGORY_ORDER: Category[] = [
  "Content",
  "Layout",
  "Typography",
  "Background",
  "Border",
  "Other",
];

const ATTR_PRETTY: Record<string, string> = {
  src: "Image source",
  alt: "Alt text",
  href: "Link URL",
  width: "Width",
  height: "Height",
  align: "Alignment",
  padding: "Padding",
  mode: "Layout mode",
  "icon-size": "Icon size",
  "font-size": "Font size",
  "font-weight": "Font weight",
  "font-family": "Font family",
  "line-height": "Line height",
  color: "Text color",
  "background-color": "Background color",
  "background-url": "Background image URL",
  border: "Border",
  "border-color": "Border color",
  "border-width": "Border width",
  "border-radius": "Border radius",
};

const ALIGN_OPTIONS = ["left", "center", "right"] as const;
const FONT_WEIGHT_OPTIONS = [
  "normal",
  "bold",
  "lighter",
  "bolder",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
];
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
const MODE_OPTIONS = ["horizontal", "vertical"];

function isColorAttr(key: string): boolean {
  return key === "color" || key.endsWith("-color");
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

function categoryOf(key: string): Category {
  return ATTR_CATEGORY[key] ?? "Other";
}

function prettyOf(key: string): string {
  return ATTR_PRETTY[key] ?? key;
}

export default function PropertiesForm({
  node,
  doc,
  onCommit,
}: PropertiesFormProps) {
  const def = BLOCK_REGISTRY[node.type];

  const initialValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of def.allowedAttrs) {
      out[key] = getAttr(node.attrs, key) ?? "";
    }
    return out;
  }, [node.id, def.allowedAttrs]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  const preservedCount = useMemo(() => {
    let n = 0;
    for (const key of node.attrs.keys()) {
      if (!def.allowedAttrs.includes(key)) n += 1;
    }
    return n;
  }, [node.id, def.allowedAttrs]);

  const flush = (key: string, value: string) => {
    setAttr(node.attrs, key, value);
    onCommit(serializeMjml(doc));
  };

  const updateAndFlush = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    flush(key, value);
  };

  const grouped = useMemo(() => {
    const buckets = new Map<Category, string[]>();
    for (const key of def.allowedAttrs) {
      const cat = categoryOf(key);
      const arr = buckets.get(cat) ?? [];
      arr.push(key);
      buckets.set(cat, arr);
    }
    return CATEGORY_ORDER.flatMap<{ category: Category; keys: string[] }>((cat) => {
      const keys = buckets.get(cat);
      return keys && keys.length > 0 ? [{ category: cat, keys }] : [];
    });
  }, [def.allowedAttrs]);

  const renderInput = (key: string) => {
    const value = values[key] ?? "";

    // Special case: mj-image src — keep the URL input + stub file picker
    // pattern from the previous implementation.
    if (node.type === "mj-image" && key === "src") {
      return (
        <>
          <input
            type="url"
            value={value}
            onChange={(e) =>
              setValues((v) => ({ ...v, [key]: e.target.value }))
            }
            onBlur={(e) => flush(key, e.target.value)}
            placeholder="https://..."
          />
          <input
            type="file"
            accept="image/*"
            // v1 stub: file uploads are not yet plumbed through. Mirrors
            // Stripo's image-source picker for parity; an actual upload
            // pipeline is a follow-up.
            onChange={() => {
              /* intentional no-op in v1 */
            }}
          />
        </>
      );
    }

    if (isColorAttr(key)) {
      const swatchValue = isHexColor(value) ? value : "#000000";
      return (
        <div className="field-color-row">
          <input
            type="color"
            className="field-color-swatch"
            value={swatchValue}
            onChange={(e) => updateAndFlush(key, e.target.value)}
            aria-label={`${prettyOf(key)} color picker`}
          />
          <input
            type="text"
            value={value}
            onChange={(e) =>
              setValues((v) => ({ ...v, [key]: e.target.value }))
            }
            onBlur={(e) => flush(key, e.target.value)}
            placeholder="#ffffff"
          />
        </div>
      );
    }

    if (key === "align") {
      return (
        <div className="field-segmented" role="radiogroup" aria-label="Alignment">
          {ALIGN_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={value === opt}
              className={value === opt ? "active" : ""}
              onClick={() => updateAndFlush(key, opt)}
            >
              {opt[0]!.toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      );
    }

    if (key === "font-weight") {
      return (
        <select
          value={value}
          onChange={(e) => updateAndFlush(key, e.target.value)}
        >
          <option value="">— Default —</option>
          {FONT_WEIGHT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (key === "font-family") {
      const known = FONT_FAMILY_OPTIONS.includes(value);
      return (
        <select
          value={known || value === "" ? value : "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") return;
            updateAndFlush(key, e.target.value);
          }}
        >
          <option value="">— Default —</option>
          {FONT_FAMILY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt.split(",")[0]}
            </option>
          ))}
          {!known && value !== "" ? (
            <option value="__custom__">{value} (custom)</option>
          ) : null}
        </select>
      );
    }

    if (key === "mode") {
      return (
        <select
          value={value}
          onChange={(e) => updateAndFlush(key, e.target.value)}
        >
          <option value="">— Default —</option>
          {MODE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type={key === "href" || key === "background-url" ? "url" : "text"}
        value={value}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        onBlur={(e) => flush(key, e.target.value)}
        placeholder={
          key === "padding"
            ? "10px 25px"
            : key === "width" || key === "height"
            ? "100%"
            : key === "font-size" || key === "line-height"
            ? "14px"
            : ""
        }
      />
    );
  };

  return (
    <div className="right-panel-form" data-block-type={node.type}>
      {preservedCount > 0 ? (
        <div className="right-panel-subtitle">
          {preservedCount} additional attribute
          {preservedCount === 1 ? "" : "s"} preserved verbatim (edit MJML
          directly to view).
        </div>
      ) : null}

      {grouped.map(({ category, keys }) => (
        <div key={category} className="field-group">
          <div className="field-group-title">{category}</div>
          {keys.map((key) => (
            <label key={key} data-attr={key}>
              <span className="field-key">{key}</span>
              <span className="field-label-text">{prettyOf(key)}</span>
              {renderInput(key)}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
