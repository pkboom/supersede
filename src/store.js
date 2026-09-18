import { COMPONENT_TAG, ExpansionError } from "./types.js";
import {
  findAllTags,
  findElementEnd,
  readRootTag,
  scanComments,
  UnterminatedCommentError,
} from "./tagScan.js";
/**
 * Checked at publish time rather than expansion time, so a violation names the
 * component being edited instead of surfacing in an unrelated template that
 * merely references it.
 */
export function assertSingleRoot(componentId, body) {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ExpansionError(`Component "${componentId}" has an empty body`);
  }
  // An unterminated comment here is worse than one in a template: the body is
  // substituted into every template referencing it, so one bad publish
  // truncates all of them, and nothing reports it because the reference did
  // expand.
  const scan = scanComments(trimmed);
  if (scan.unterminatedAt !== undefined) {
    throw new UnterminatedCommentError(scan.unterminatedAt);
  }
  const root = readRootTag(trimmed);
  if (!root) {
    throw new ExpansionError(`Component "${componentId}" body has no root element`);
  }
  // The root must span the whole body; anything but whitespace after it is a
  // second root.
  const end = findElementEnd(trimmed, root);
  if (end === null) {
    throw new ExpansionError(`Component "${componentId}" body has an unclosed <${root.name}> root`);
  }
  const tail = trimmed.slice(end);
  if (tail.trim().length > 0) {
    throw new ExpansionError(
      `Component "${componentId}" body must have exactly ONE root element; ` +
        `found trailing content after <${root.name}>. The single-root invariant ` +
        `is what keeps stored and expanded index paths 1:1.`,
    );
  }
}
/**
 * Not a database table on purpose: components get persisted once a real agency
 * has used the model, so the schema is shaped by what they needed. Serialising
 * to JSON is enough to hand-migrate today.
 */
export class InMemoryComponentStore {
  /** componentId -> revision number -> revision. */
  byId = new Map();
  get(componentId, revision) {
    return this.byId.get(componentId)?.get(revision);
  }
  latest(componentId) {
    const revs = this.byId.get(componentId);
    if (!revs || revs.size === 0) return undefined;
    const max = Math.max(...revs.keys());
    return revs.get(max);
  }
  list() {
    const out = [];
    for (const revs of this.byId.values()) out.push(...revs.values());
    return out.sort(
      (a, b) => a.componentId.localeCompare(b.componentId) || a.revision - b.revision,
    );
  }
  /**
   * The revision number is allocated here and cannot be supplied, so this can
   * never overwrite an existing one — a pinned template would otherwise change
   * content without its pin moving.
   */
  publish(componentId, body, opts = {}) {
    assertSingleRoot(componentId, body);
    // A body may reference other components but not itself, which the depth cap
    // would only turn into a confusing error later.
    for (const tag of findAllTags(body, COMPONENT_TAG)) {
      const id = tag.attrs.find((a) => a.name === "component-id")?.value;
      if (id === componentId) {
        throw new ExpansionError(`Component "${componentId}" references itself`);
      }
    }
    let revs = this.byId.get(componentId);
    if (!revs) {
      revs = new Map();
      this.byId.set(componentId, revs);
    }
    const next = revs.size === 0 ? 1 : Math.max(...revs.keys()) + 1;
    const rev = {
      componentId,
      revision: next,
      body: body.trim(),
      label: opts.label,
      publishedAt: opts.publishedAt ?? new Date(),
    };
    revs.set(next, rev);
    return rev;
  }
  toJSON() {
    return this.list().map((r) => ({
      ...r,
      publishedAt: r.publishedAt.toISOString(),
    }));
  }
  /**
   * The hand-migration entry point, and so the one path that can violate every
   * invariant `publish` enforces — hence the re-checks rather than trusting
   * the file.
   */
  static fromJSON(raw) {
    const store = new InMemoryComponentStore();
    if (!Array.isArray(raw)) return store;
    for (const [i, item] of raw.entries()) {
      if (typeof item?.componentId !== "string" || !item.componentId) {
        throw new ExpansionError(`Entry ${i} has no componentId`);
      }
      const componentId = item.componentId;
      const revision = Number(item.revision);
      if (!Number.isInteger(revision) || revision < 1) {
        throw new ExpansionError(
          `Component "${componentId}" entry ${i} has a non-integer revision: ${String(item.revision)}`,
        );
      }
      if (typeof item.body !== "string") {
        throw new ExpansionError(
          `Component "${componentId}" revision ${revision} has no body string`,
        );
      }
      assertSingleRoot(componentId, item.body);
      const publishedAt = new Date(String(item.publishedAt));
      if (Number.isNaN(publishedAt.getTime())) {
        throw new ExpansionError(
          `Component "${componentId}" revision ${revision} has an invalid publishedAt`,
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
            `revisions are immutable and a duplicate would silently change pinned content`,
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
