import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMjml } from "../shared/blocks/parser.js";
import { BLOCK_REGISTRY } from "../shared/blocks/registry.js";
import type { BlockDef } from "../shared/blocks/registry.js";

// Read starter.mjml once at module load. Sync read keeps the byte-stability
// snapshot trivial — the constant is frozen at process start.
const here = dirname(fileURLToPath(import.meta.url));
const STARTER_MJML_PATH = resolve(here, "..", "templates", "starter.mjml");
export const STARTER_MJML = readFileSync(STARTER_MJML_PATH, "utf8");

/**
 * Consolidated v2 system guidance, stitched from the v1 agent .md files
 * (email-designer / email-copywriter / email-reviewer). v2 dispatches all
 * three roles in a single API turn — the LLM picks the right behaviour from
 * the user's query rather than via subagent routing.
 *
 * The text below is intentionally stable. Any edit must be paired with an
 * update to the byte-stability snapshot fixture.
 */
export const SYSTEM_GUIDANCE = `You are an expert email designer working on an MJML email template.

You operate in three modes depending on the user's request:

VISUAL MODE — when the user asks for layout, color, font, spacing, alignment, padding, or sizing changes:
- Make the smallest viable edit; never rewrite the whole file when an attribute change suffices.
- Preserve all <mj-raw>, comments, and unmodeled MJML constructs verbatim.
- Use only blocks listed in the catalog below.

COPY MODE — when the user asks for headline, body, subject, button label, or other text changes:
- Change only the text content between tags. Preserve all attributes (colors, padding, fonts).
- Never invent images. If asked for an image, return a one-paragraph image-prompt suggestion in the "reply" field and a one-line instruction "Drop the resulting image into the canvas once generated." Do NOT modify the mjml in that case.

REVIEW MODE — when the user asks for a QA / accessibility / spam / mobile / dark-mode audit:
- Return your findings in the "reply" field as a structured markdown report.
- Do NOT modify the mjml. Echo it back unchanged.

Output contract: a single JSON object with two fields:
- "mjml": the COMPLETE updated MJML source. Always include the full <mjml>...</mjml> document, never a fragment.
- "reply": a short conversational reply describing what you changed (or, in REVIEW MODE, the audit report).

Constraints:
- Use only the block types listed in the catalog. Never introduce unmodeled tags. Wrap any unavoidable raw HTML in <mj-raw>.
- Preserve insertion order of attributes when editing.
- The mjml must parse — malformed output is rejected by the server and the user sees an error.`;

const EMPTY_BODY_INSTRUCTION = "The current template is empty. Create a new email template using only the blocks listed above and the user's request. Use the structural example below as a starting point.";

const CATALOG_HEADER = "Available block types (use ONLY these):";

export interface BuiltPrompt {
  systemGuidance: string;
  blockCatalog: string;
  mjml: string;
  query: string;
}

export interface BuildPromptInput {
  mjml: string;
  query: string;
  /**
   * Optional override for tests. Typed loosely as `Record<string, BlockDef>`
   * — the production registry has the strict `Record<BlockType, BlockDef>`
   * shape, but tests inject frozen stubs keyed by arbitrary strings.
   */
  registry?: Readonly<Record<string, BlockDef>>;
}

/**
 * Builds the prompt fragments for one Claude turn. Always emits the catalog —
 * no code path omits it (per spec AC line 226). Catalog ordering is
 * deterministic (`Object.keys(registry).sort()`); within each entry, defaults
 * keys are also sorted. Together this guarantees byte-stability across runs.
 *
 * `mj-custom-passthrough` is excluded from the catalog (it's an internal
 * preservation primitive, not a block the LLM should emit).
 *
 * `registry?` is for tests — the byte-stability snapshot injects a frozen
 * 2-block stub.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const registry: Readonly<Record<string, BlockDef>> = input.registry ?? BLOCK_REGISTRY;
  const types = Object.keys(registry)
    .filter((k) => k !== "mj-custom-passthrough")
    .sort();

  const catalogLines = types.map((tag) => formatCatalogEntry(tag, registry[tag]!));
  let blockCatalog = `${CATALOG_HEADER}\n${catalogLines.join("\n")}`;

  let bodyEmpty = false;
  try {
    bodyEmpty = parseMjml(input.mjml).body.length === 0;
  } catch {
    // Treat parse failure as non-empty: the LLM sees the broken MJML and is
    // expected to repair it from the user's query. Don't trigger the
    // empty-body branch on parse failure.
    bodyEmpty = false;
  }

  if (bodyEmpty) {
    blockCatalog += `\n\n${EMPTY_BODY_INSTRUCTION}\n\n${STARTER_MJML}`;
  }

  return {
    systemGuidance: SYSTEM_GUIDANCE,
    blockCatalog,
    mjml: input.mjml,
    query: input.query,
  };
}

function formatCatalogEntry(tag: string, def: BlockDef): string {
  const role = def.isContainer ? "container" : "leaf";
  const children = def.isContainer
    ? `, children=[${(def.allowedChildren ?? []).join(", ")}]`
    : "";
  const text = def.contentField === "text" ? ", text-content" : "";
  const attrs = `attrs=[${def.allowedAttrs.join(", ")}]`;
  const defaultsKeys = Object.keys(def.defaults).sort();
  const defaults = defaultsKeys.length === 0
    ? "defaults={}"
    : `defaults={${defaultsKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(def.defaults[k])}`).join(",")}}`;
  return `- ${tag}: ${role}${children}${text}, ${attrs}, ${defaults}`;
}
