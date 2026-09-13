/**
 * In-memory component store of immutable revisions (plan §12, weeks 2-4).
 *
 * Deliberately NOT a database table. The vertical slice is terminal-only and
 * explicitly scoped "no brands table, no API refactor, no auth" — components
 * get persisted properly once one real agency has actually used the model, so
 * the schema is shaped by what they needed rather than by what we guessed.
 * Serialising to JSON is enough to run a migration by hand today.
 */
import {
  COMPONENT_TAG,
  type ComponentRevision,
  type ComponentStore,
  ExpansionError,
} from "./types.js";
import { findAllTags, readRootTag } from "./tagScan.js";

/**
 * Validate the single-root invariant.
 *
 * This is enforced at PUBLISH time, not at expansion time, and that placement
 * is deliberate: a violation caught here names the component the author is
 * editing, while the same violation caught during expansion surfaces as a
 * confusing failure in an unrelated template that merely references it.
 */
export function assertSingleRoot(componentId: string, body: string): void {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ExpansionError(`Component "${componentId}" has an empty body`);
  }

  const root = readRootTag(trimmed);
  if (!root) {
    throw new ExpansionError(
      `Component "${componentId}" body has no root element`
    );
  }

  // The root must span the whole body. If anything but whitespace follows it,
  // there is a second root.
  const tail = trimmed.slice(root.selfClosing ? root.end : closingEnd(trimmed, root.name, root.end));
  if (tail.trim().length > 0) {
    throw new ExpansionError(
      `Component "${componentId}" body must have exactly ONE root element; ` +
        `found trailing content after <${root.name}>. The single-root invariant ` +
        `is what keeps stored and expanded index paths 1:1.`
    );
  }
}

/** Offset just past the matching close tag for an element opened at `openEnd`. */
function closingEnd(src: string, name: string, openEnd: number): number {
  let depth = 1;
  let cursor = openEnd;
  const openRe = new RegExp(`<\\s*${name}(?![\\w-])`, "g");
  const closeRe = new RegExp(`<\\s*\\/\\s*${name}\\s*>`, "g");
  while (cursor < src.length && depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const o = openRe.exec(src);
    const c = closeRe.exec(src);
    if (!c) return src.length;
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + 1;
    } else {
      depth--;
      cursor = c.index + c[0].length;
    }
  }
  return cursor;
}

export class InMemoryComponentStore implements ComponentStore {
  /** componentId -> revision number -> revision. */
  private readonly byId = new Map<string, Map<number, ComponentRevision>>();

  get(componentId: string, revision: number): ComponentRevision | undefined {
    return this.byId.get(componentId)?.get(revision);
  }

  latest(componentId: string): ComponentRevision | undefined {
    const revs = this.byId.get(componentId);
    if (!revs || revs.size === 0) return undefined;
    const max = Math.max(...revs.keys());
    return revs.get(max);
  }

  list(): ComponentRevision[] {
    const out: ComponentRevision[] = [];
    for (const revs of this.byId.values()) out.push(...revs.values());
    return out.sort(
      (a, b) =>
        a.componentId.localeCompare(b.componentId) || a.revision - b.revision
    );
  }

  /**
   * Publish a new immutable revision. Returns it.
   *
   * Revisions are append-only: re-publishing an existing revision number is an
   * error rather than an overwrite, because a template pinned to it would
   * silently change content without its pin moving — which is precisely the
   * property the reference model exists to prevent.
   */
  publish(
    componentId: string,
    body: string,
    opts: { label?: string; publishedAt?: Date } = {}
  ): ComponentRevision {
    assertSingleRoot(componentId, body);

    // A component body may reference other components, but it must not
    // reference ITSELF — that is an unconditional infinite expansion the depth
    // cap would only convert into a confusing error later.
    for (const tag of findAllTags(body, COMPONENT_TAG)) {
      const id = tag.attrs.find((a) => a.name === "component-id")?.value;
      if (id === componentId) {
        throw new ExpansionError(
          `Component "${componentId}" references itself`
        );
      }
    }

    let revs = this.byId.get(componentId);
    if (!revs) {
      revs = new Map();
      this.byId.set(componentId, revs);
    }
    const next = revs.size === 0 ? 1 : Math.max(...revs.keys()) + 1;
    const rev: ComponentRevision = {
      componentId,
      revision: next,
      body: body.trim(),
      label: opts.label,
      publishedAt: opts.publishedAt ?? new Date(),
    };
    revs.set(next, rev);
    return rev;
  }

  toJSON(): unknown {
    return this.list().map((r) => ({
      ...r,
      publishedAt: r.publishedAt.toISOString(),
    }));
  }

  static fromJSON(raw: unknown): InMemoryComponentStore {
    const store = new InMemoryComponentStore();
    if (!Array.isArray(raw)) return store;
    for (const item of raw as Array<Record<string, unknown>>) {
      const componentId = String(item.componentId);
      const revision = Number(item.revision);
      let revs = store.byId.get(componentId);
      if (!revs) {
        revs = new Map();
        store.byId.set(componentId, revs);
      }
      revs.set(revision, {
        componentId,
        revision,
        body: String(item.body),
        label: item.label === undefined ? undefined : String(item.label),
        publishedAt: new Date(String(item.publishedAt)),
      });
    }
    return store;
  }
}
