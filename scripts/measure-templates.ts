/**
 * Measurement harness for the two gating questions in the plan (§3.5 and §11
 * experiment (b)), which must be answered against REAL agency templates before
 * any more of the design system gets built.
 *
 * The plan says to run both in one sitting because they are the same ten
 * templates and largely the same computation. This does exactly that.
 *
 *   npm run measure -- ./path/to/templates      # a directory of .mjml files
 *   npm run measure -- a.mjml b.mjml c.mjml     # or explicit files
 *   npm run measure -- ./templates --json       # machine-readable
 *
 * WHY THIS EXISTS AS A TOOL
 * -------------------------
 * Both questions gate real decisions, and both are the kind of thing that gets
 * eyeballed, guessed at, and then quietly treated as settled. The numbers below
 * are cheap to produce and expensive to be wrong about:
 *
 *  - **§11 experiment (b)** decides whether flat, root-level `ov-*` overrides
 *    are sufficient. If the average attribute variance per instance is above
 *    ~3, `ov-*` degenerates into the copy model with worse ergonomics and the
 *    reference verdict (D-2) re-opens — which would invalidate the expander
 *    this repo now contains.
 *
 *    The average ALONE is not the gate, and that nearly shipped as the gate.
 *    `ov-*` reaches the component root and named text slots only. The overrides
 *    email components actually need are frequently BELOW the root: a footer can
 *    have its background overridden but not its unsubscribe link. So the second
 *    number — what fraction of differing attributes sit below the root — can
 *    fail the design while the average passes.
 *
 *  - **§3.5** sizes componentization cost: how much of a real template the
 *    parser can actually address. Under the reference model this is no longer a
 *    viability gate (expansion substitutes a fixed-shape token and runs through
 *    opaque constructs), but it is the go-to-market cost, because it is the
 *    work a migration has to do by hand.
 *
 *  - **§14** counts `mj-text` blocks carrying inline HTML. Any inline element
 *    demotes the whole leaf to an opaque node, and inline HTML in copy is the
 *    norm in real email — so this may be the largest share of the opaque
 *    surface, independent of components.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { parseMjml } from "../src/shared/blocks/parser.js";
import type { BlockNode, TreeNode } from "../src/shared/blocks/types.js";

// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
};

function heading(s: string): void {
  console.log(`\n${c.bold(s)}\n${c.dim("─".repeat(Math.min(s.length, 76)))}`);
}

function collectFiles(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a.startsWith("--")) continue;
    let st;
    try {
      st = statSync(a);
    } catch {
      console.error(`Cannot read ${a}`);
      continue;
    }
    if (st.isDirectory()) {
      for (const f of readdirSync(a)) {
        if ([".mjml", ".html", ".txt"].includes(extname(f).toLowerCase())) {
          out.push(join(a, f));
        }
      }
    } else {
      out.push(a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3.5 / §14 — reachability
// ---------------------------------------------------------------------------

interface Reach {
  modeled: number;
  opaque: number;
  opaqueBy: Record<string, number>;
  richText: number;
  plainText: number;
}

function measureReach(doc: ReturnType<typeof parseMjml>): Reach {
  const r: Reach = {
    modeled: 0,
    opaque: 0,
    opaqueBy: {},
    richText: 0,
    plainText: 0,
  };

  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.type === "mj-custom-passthrough") {
        r.opaque++;
        const key = `<${n.originalTagName}>`;
        r.opaqueBy[key] = (r.opaqueBy[key] ?? 0) + 1;
        // A rich mj-text demotes to a passthrough; count it separately because
        // it has no registry fix, unlike mj-wrapper / mj-hero / mj-navbar.
        if (n.originalTagName === "mj-text") r.richText++;
        continue;
      }
      if (n.type === "__unknown__") continue; // comments and stray text
      r.modeled++;
      if (n.type === "mj-text") r.plainText++;
      if (n.children) walk(n.children);
    }
  };

  walk(doc.body);
  return r;
}

// ---------------------------------------------------------------------------
// §11 experiment (b) — attribute variance across repeated blocks
// ---------------------------------------------------------------------------

/**
 * A "shape" groups blocks that a component could plausibly unify: same tag, and
 * (for containers) the same child-tag sequence. Blocks sharing a shape are the
 * candidates a shared component would replace.
 */
function shapeKey(n: BlockNode): string {
  const kids = (n.children ?? [])
    .map((k) => (k.type === "mj-custom-passthrough" ? k.originalTagName : k.type))
    .join(",");
  return kids ? `${n.type}[${kids}]` : n.type;
}

interface ShapeStat {
  shape: string;
  instances: number;
  /** Mean count of attributes whose value differs from the modal value. */
  meanDiffering: number;
  /** Of all differing attributes, the share sitting BELOW the group's root. */
  belowRootShare: number;
  differingKeys: string[];
}

function measureVariance(docs: ReturnType<typeof parseMjml>[]): ShapeStat[] {
  // Collect every modeled block, keyed by shape, with its depth relative to the
  // shape root recorded so below-root differences can be separated.
  const groups = new Map<string, Array<{ node: BlockNode; depth: number }>>();

  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const n of nodes) {
      if (n.type === "__unknown__" || n.type === "mj-custom-passthrough") continue;
      const key = shapeKey(n);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ node: n, depth });
      if (n.children) walk(n.children, depth + 1);
    }
  };
  for (const d of docs) walk(d.body, 0);

  const stats: ShapeStat[] = [];

  for (const [shape, members] of groups) {
    if (members.length < 2) continue; // a single instance cannot vary

    // Modal value per attribute across the group's ROOT nodes.
    const valueCounts = new Map<string, Map<string, number>>();
    for (const { node } of members) {
      for (const [k, v] of node.attrs) {
        if (!valueCounts.has(k)) valueCounts.set(k, new Map());
        const m = valueCounts.get(k)!;
        m.set(v, (m.get(v) ?? 0) + 1);
      }
    }
    const modal = new Map<string, string>();
    for (const [k, m] of valueCounts) {
      modal.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
    }

    let totalDiffering = 0;
    let belowRootDiffering = 0;
    const differingKeys = new Set<string>();

    for (const { node } of members) {
      // Root-level differences.
      for (const [k, v] of node.attrs) {
        if (modal.get(k) !== v) {
          totalDiffering++;
          differingKeys.add(k);
        }
      }
      // Below-root differences: compare descendants position-by-position
      // against the first member, which stands in for the component body.
      const first = members[0]!.node;
      const descend = (a: TreeNode[], b: TreeNode[]): void => {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const x = a[i]!, y = b[i]!;
          if (x.type !== y.type) continue;
          if (x.type === "__unknown__" || x.type === "mj-custom-passthrough") continue;
          if (y.type === "__unknown__" || y.type === "mj-custom-passthrough") continue;
          for (const [k, v] of x.attrs) {
            if (y.attrs.get(k) !== v) {
              totalDiffering++;
              belowRootDiffering++;
              differingKeys.add(`(below-root) ${k}`);
            }
          }
          if (x.children && y.children) descend(x.children, y.children);
        }
      };
      if (node !== first && node.children && first.children) {
        descend(node.children, first.children);
      }
    }

    stats.push({
      shape,
      instances: members.length,
      meanDiffering: totalDiffering / members.length,
      belowRootShare: totalDiffering === 0 ? 0 : belowRootDiffering / totalDiffering,
      differingKeys: [...differingKeys].slice(0, 8),
    });
  }

  return stats.sort((a, b) => b.instances - a.instances);
}

// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const files = collectFiles(args);

  if (files.length === 0) {
    console.error(
      "Usage: npm run measure -- <dir-of-templates | file.mjml ...> [--json]\n\n" +
        "Answers the two questions that gate further design-system work:\n" +
        "  §11 experiment (b) — is flat root-level ov-* sufficient?\n" +
        "  §3.5              — how much of a real template can the parser address?"
    );
    process.exit(2);
  }

  const docs: ReturnType<typeof parseMjml>[] = [];
  const perFile: Array<{ name: string; reach: Reach }> = [];

  for (const f of files) {
    let doc;
    try {
      doc = parseMjml(readFileSync(f, "utf8"));
    } catch (err) {
      console.error(`${basename(f)}: failed to parse — ${(err as Error).message}`);
      continue;
    }
    docs.push(doc);
    perFile.push({ name: basename(f), reach: measureReach(doc) });
  }

  const variance = measureVariance(docs);

  const totals = perFile.reduce<Reach>(
    (a, { reach }) => ({
      modeled: a.modeled + reach.modeled,
      opaque: a.opaque + reach.opaque,
      opaqueBy: Object.entries(reach.opaqueBy).reduce((o, [k, v]) => {
        o[k] = (o[k] ?? 0) + v;
        return o;
      }, a.opaqueBy),
      richText: a.richText + reach.richText,
      plainText: a.plainText + reach.plainText,
    }),
    { modeled: 0, opaque: 0, opaqueBy: {}, richText: 0, plainText: 0 }
  );

  // The headline numbers, computed once so text and JSON cannot disagree.
  const repeated = variance.filter((v) => v.instances >= 2);
  const weightedMean =
    repeated.length === 0
      ? 0
      : repeated.reduce((s, v) => s + v.meanDiffering * v.instances, 0) /
        repeated.reduce((s, v) => s + v.instances, 0);
  const weightedBelowRoot =
    repeated.length === 0
      ? 0
      : repeated.reduce((s, v) => s + v.belowRootShare * v.instances, 0) /
        repeated.reduce((s, v) => s + v.instances, 0);
  const opaqueShare =
    totals.modeled + totals.opaque === 0
      ? 0
      : totals.opaque / (totals.modeled + totals.opaque);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          files: files.length,
          experimentB: {
            meanDifferingAttrsPerInstance: Number(weightedMean.toFixed(2)),
            belowRootShare: Number(weightedBelowRoot.toFixed(3)),
            reopensD2: weightedMean > 3 || weightedBelowRoot > 0.5,
            shapes: variance,
          },
          reachability: { ...totals, opaqueShare: Number(opaqueShare.toFixed(3)) },
        },
        null,
        2
      )
    );
    return;
  }

  heading(`Measured ${files.length} template(s)`);

  // ---- §11 experiment (b) ----
  heading("§11 experiment (b) — is flat root-level ov-* sufficient?");
  if (repeated.length === 0) {
    console.log(
      c.yellow(
        "  No repeated block shapes found. Either these templates share no structure,\n" +
          "  or there are too few of them. This is not a pass — it means the experiment\n" +
          "  did not run. Use ten real templates from ONE brand."
      )
    );
  } else {
    console.log(`  ${"shape".padEnd(38)} ${"n".padStart(3)}  ${"mean diff".padStart(9)}  below-root`);
    for (const v of repeated.slice(0, 14)) {
      const flag = v.meanDiffering > 3 ? c.red : c.green;
      console.log(
        `  ${v.shape.slice(0, 38).padEnd(38)} ${String(v.instances).padStart(3)}  ` +
          `${flag(v.meanDiffering.toFixed(2).padStart(9))}  ${(v.belowRootShare * 100).toFixed(0)}%`
      );
    }
    console.log();
    console.log(`  ${c.bold("mean differing attributes per instance:")} ${weightedMean.toFixed(2)}`);
    console.log(`  ${c.bold("share of differences BELOW the root:")}    ${(weightedBelowRoot * 100).toFixed(0)}%`);
    console.log();

    const avgFails = weightedMean > 3;
    const belowFails = weightedBelowRoot > 0.5;
    if (avgFails || belowFails) {
      console.log(c.red("  VERDICT: D-2 SHOULD RE-OPEN."));
      if (avgFails) {
        console.log(
          c.dim("    The average is above ~3, so ov-* degenerates into the copy model\n" +
                "    with worse ergonomics.")
        );
      }
      if (belowFails) {
        console.log(
          c.dim("    Most differences target BELOW the component root, which flat ov-*\n" +
                "    cannot express. Detach would become the routine path rather than an\n" +
                "    escape hatch — the copy model reached by attrition, through a\n" +
                "    one-way door.")
        );
      }
    } else {
      console.log(c.green("  VERDICT: flat root-level ov-* is sufficient for this corpus."));
      console.log(
        c.dim("    Note the average alone was never the gate: the below-root share is\n" +
              "    what would fail the design while the average passed.")
      );
    }
  }

  // ---- §3.5 / §14 ----
  heading("§3.5 — how much of a real template can the parser address?");
  console.log(`  ${"template".padEnd(34)} ${"modeled".padStart(8)} ${"opaque".padStart(7)}`);
  for (const { name, reach } of perFile) {
    const share = reach.modeled + reach.opaque === 0 ? 0 : reach.opaque / (reach.modeled + reach.opaque);
    const flag = share > 0.2 ? c.yellow : c.green;
    console.log(
      `  ${name.slice(0, 34).padEnd(34)} ${String(reach.modeled).padStart(8)} ${flag(String(reach.opaque).padStart(7))}`
    );
  }
  console.log();
  console.log(`  ${c.bold("opaque share:")} ${(opaqueShare * 100).toFixed(1)}%  ${c.dim(`(${totals.opaque} of ${totals.modeled + totals.opaque} nodes)`)}`);
  if (Object.keys(totals.opaqueBy).length > 0) {
    console.log(`  ${c.bold("by construct:")}`);
    for (const [k, n] of Object.entries(totals.opaqueBy).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${k}`);
    }
  }

  heading("§14 — rich mj-text (inline HTML in copy)");
  const textTotal = totals.richText + totals.plainText;
  const richShare = textTotal === 0 ? 0 : totals.richText / textTotal;
  console.log(
    `  ${totals.richText} of ${textTotal} text blocks carry inline HTML ` +
      `(${(richShare * 100).toFixed(0)}%)`
  );
  console.log(
    c.dim(
      "\n  Rich mj-text has NO registry fix — any inline element demotes the whole\n" +
        "  leaf. mj-wrapper / mj-hero / mj-navbar are registry gaps and can be closed;\n" +
        "  this cannot. If this share is large, it bounds the addressable surface\n" +
        "  independently of components, and it ships today."
    )
  );

  heading("What to do with these numbers");
  console.log(
    c.dim(
      "  · Above ~3 mean differing attributes, OR most differences below the root:\n" +
        "    stop and re-open D-2 before building further on the reference model.\n" +
        "  · A large opaque share is a MIGRATION COST, not a blocker — it is the\n" +
        "    hand work a first agency onboarding has to do.\n" +
        "  · The by-construct breakdown says whether modelling mj-wrapper is worth\n" +
        "    it. Note that is not the cheap registry edit the plan assumes: mjml\n" +
        "    renders mj-wrapper as a div+table structurally identical to mj-section,\n" +
        "    so stampPaths needs a detector that can tell them apart, and getting\n" +
        "    that wrong mis-targets canvas clicks silently."
    )
  );
  console.log();
}

main();
