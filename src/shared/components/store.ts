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
import {
  findAllTags,
  findElementEnd,
  readRootTag,
  scanComments,
  UnterminatedCommentError,
} from "./tagScan.js";

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

  // An unterminated comment in a component BODY is worse than one in a
  // template: the body is substituted into every template that references it,
  // so one bad publish silently truncates all of them — and because the
  // reference itself expanded, mjml reports nothing and the compiler-authority
  // check has nothing to fire on. Catch it at publish time, where the error can
  // name the component being edited.
  const scan = scanComments(trimmed);
  if (scan.unterminatedAt !== undefined) {
    throw new UnterminatedCommentError(scan.unterminatedAt);
  }

  const root = readRootTag(trimmed);
  if (!root) {
    throw new ExpansionError(
      `Component "${componentId}" body has no root element`
    );
  }

  // The root must span the whole body. If anything but whitespace follows it,
  // there is a second root.
  const end = findElementEnd(trimmed, root);
  if (end === null) {
    throw new ExpansionError(
      `Component "${componentId}" body has an unclosed <${root.name}> root. ` +
        `(An earlier implementation treated "never closed" as "closes at the end", ` +
        `which made this check pass vacuously for exactly the malformed bodies it exists to reject.)`
    );
  }
  const tail = trimmed.slice(end);
  if (tail.trim().length > 0) {
    throw new ExpansionError(
      `Component "${componentId}" body must have exactly ONE root element; ` +
        `found trailing content after <${root.name}>. The single-root invariant ` +
        `is what keeps stored and expanded index paths 1:1.`
    );
  }
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
   * Revisions are append-only: the number is ALLOCATED here (max + 1) and
   * cannot be supplied by the caller, so an existing revision can never be
   * overwritten through this method. That matters because a template pinned to
   * a revision would otherwise change content without its pin moving — exactly
   * the property the reference model exists to prevent.
   *
   * `fromJSON` is the path that CAN violate this, and it validates separately.
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

  /**
   * Rehydrate from JSON.
   *
   * This is the hand-migration entry point, which makes it the one path that
   * can violate every invariant `publish()` enforces — so it re-checks them
   * rather than trusting the file. An earlier version coerced blindly
   * (`String(undefined)` becoming the literal `"undefined"` as a body) and
   * silently overwrote duplicate revisions.
   */
  static fromJSON(raw: unknown): InMemoryComponentStore {
    const store = new InMemoryComponentStore();
    if (!Array.isArray(raw)) return store;

    for (const [i, item] of (raw as Array<Record<string, unknown>>).entries()) {
      if (typeof item?.componentId !== "string" || !item.componentId) {
        throw new ExpansionError(`Entry ${i} has no componentId`);
      }
      const componentId = item.componentId;

      const revision = Number(item.revision);
      if (!Number.isInteger(revision) || revision < 1) {
        throw new ExpansionError(
          `Component "${componentId}" entry ${i} has a non-integer revision: ${String(item.revision)}`
        );
      }
      if (typeof item.body !== "string") {
        throw new ExpansionError(
          `Component "${componentId}" revision ${revision} has no body string`
        );
      }
      assertSingleRoot(componentId, item.body);

      const publishedAt = new Date(String(item.publishedAt));
      if (Number.isNaN(publishedAt.getTime())) {
        throw new ExpansionError(
          `Component "${componentId}" revision ${revision} has an invalid publishedAt`
        );
      }

      let revs = store.byId.get(componentId);
      if (!revs) {
        revs = new Map();
        store.byId.set(componentId, revs);
      }
      if (revs.has(revision)) {
        throw new ExpansionError(
          `Component "${componentId}" has duplicate revision ${revision}; ` +
            `revisions are immutable and a duplicate would silently change pinned content`
        );
      }
      revs.set(revision, {
        componentId,
        revision,
        body: item.body,
        label: item.label === undefined ? undefined : String(item.label),
        publishedAt,
      });
    }
    return store;
  }
}
