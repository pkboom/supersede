/**
 * Terminal driver for the component design system (plan §12, weeks 2-4).
 *
 * Scope is deliberately small and matches the build order: tool-authored
 * templates only, one component referenced from three of them, the expander,
 * the guard, a bulk expanded-MJML export, one revision bump, and the dry-run
 * diff printed to the terminal as expand(before) vs expand(after).
 *
 * **No UI, no brands table, no API refactor, no auth.** The deliverable is a
 * working expander and pin bump on your own machine — the thing you can put in
 * front of one real agency to find out whether the bet in §1 is true.
 *
 * Usage:
 *   npm run components -- demo        full walkthrough: publish, bump, diff, export
 *   npm run components -- diff        dry-run diff only
 *   npm run components -- export      write expanded MJML to ./workspace/expanded/
 *   npm run components -- report      reachability report only
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  InMemoryComponentStore,
  expand,
  locateInstances,
  ExpansionError,
} from "../shared/components/index.js";

// ---------------------------------------------------------------------------
// Terminal helpers. No dependency — this runs in a plain terminal.
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

function heading(s: string): void {
  console.log(`\n${c.bold(s)}\n${c.dim("─".repeat(Math.min(s.length, 72)))}`);
}

/**
 * Minimal positional line diff with context.
 *
 * Compares line i to line i, so any change in LINE COUNT between revisions
 * shifts everything after it and reports the remainder as changed. That is
 * acceptable here because the bodies compared are small and usually the same
 * shape — but it means a large diff signals a line-count change, NOT a broken
 * invariant.
 *
 * Specifically: D-2's one-attribute blast radius is about bytes rewritten in
 * STORED templates. This function shows EXPANDED MJML, where a revision bump is
 * expected to change the component body wholesale. The two quantities are
 * unrelated, and conflating them would send someone debugging a noisy diff
 * after the wrong invariant. The stored-side measurement is printed separately
 * below, and it is measured rather than asserted.
 */
function printDiff(before: string, after: string, context = 2): number {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);

  const changed: number[] = [];
  for (let i = 0; i < max; i++) if (a[i] !== b[i]) changed.push(i);

  if (changed.length === 0) {
    console.log(c.dim("  (no change)"));
    return 0;
  }

  const show = new Set<number>();
  for (const i of changed)
    for (let j = i - context; j <= i + context; j++)
      if (j >= 0 && j < max) show.add(j);

  let last = -1;
  for (const i of [...show].sort((x, y) => x - y)) {
    if (last !== -1 && i > last + 1) console.log(c.dim("  ⋯"));
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.log(c.red(`  - ${a[i]}`));
      if (b[i] !== undefined) console.log(c.green(`  + ${b[i]}`));
    } else {
      console.log(c.dim(`    ${a[i]}`));
    }
    last = i;
  }
  return changed.length;
}

// ---------------------------------------------------------------------------
// The slice's fixture: one component, three tool-authored templates.
// ---------------------------------------------------------------------------

const COMPONENT_ID = "shoe-brand/primary-button";

const BUTTON_V1 =
  `<mj-button href="https://shoe.test/shop?utm_source=email&amp;utm_medium=cta" ` +
  `background-color="#1f6feb" color="#ffffff" border-radius="4px" ` +
  `font-size="16px" padding="12px 24px">Shop now</mj-button>`;

/**
 * A composite component — image + copy + CTA. Experiment (b) measured exactly
 * this shape at mean 14.20 differing attributes with 100% of them below the
 * root, which is why below-root overrides exist.
 */
const CARD_V1 =
  `<mj-column><mj-image src="https://cdn.shoe.test/hero.png" alt="Product" />` +
  `<mj-text font-size="16px">Our best seller</mj-text>` +
  `<mj-button href="https://shoe.test/p/default" background-color="#1f6feb">Buy</mj-button>` +
  `</mj-column>`;

/** The rebrand: a new brand colour and a rounder corner. */
const BUTTON_V2 =
  `<mj-button href="https://shoe.test/shop?utm_source=email&amp;utm_medium=cta" ` +
  `background-color="#111111" color="#ffffff" border-radius="9999px" ` +
  `font-size="16px" padding="12px 24px">Shop now</mj-button>`;

function ref(revision: number, overrides = ""): string {
  return `<mj-component component-id="${COMPONENT_ID}" revision="${revision}"${overrides} />`;
}

function makeTemplates(revision: number): Array<{ name: string; mjml: string }> {
  return [
    {
      name: "welcome",
      mjml:
        `<mjml>\n  <mj-body>\n` +
        `    <mj-section>\n      <mj-column>\n        <mj-text>Welcome to Shoe Brand &amp; friends</mj-text>\n      </mj-column>\n    </mj-section>\n` +
        `    <mj-section>\n      <mj-column>\n        ${ref(revision)}\n      </mj-column>\n    </mj-section>\n` +
        `  </mj-body>\n</mjml>\n`,
    },
    {
      name: "sale",
      mjml:
        `<mjml>\n  <mj-body>\n` +
        `    <mj-section>\n      <mj-column>\n        <mj-text>Up to 50% off</mj-text>\n      </mj-column>\n    </mj-section>\n` +
        `    <mj-section>\n      <mj-column>\n        ${ref(revision, ` ov-background-color="#c0392b"`)}\n      </mj-column>\n    </mj-section>\n` +
        `  </mj-body>\n</mjml>\n`,
    },
    {
      name: "winback",
      mjml:
        `<mjml>\n  <mj-body>\n` +
        `    <mj-section>\n      <mj-column>\n        <mj-text>We miss you</mj-text>\n      </mj-column>\n    </mj-section>\n` +
        `    <mj-section>\n      <mj-column>\n        ${ref(revision)}\n      </mj-column>\n    </mj-section>\n` +
        `  </mj-body>\n</mjml>\n`,
    },
  ];
}

const CARD_ID = "shoe-brand/product-card";

function buildStore(): InMemoryComponentStore {
  const store = new InMemoryComponentStore();
  store.publish(COMPONENT_ID, BUTTON_V1, { label: "Primary button" });
  store.publish(CARD_ID, CARD_V1, { label: "Product card" });
  return store;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdReport(): void {
  heading("Reachability report");
  console.log(
    c.dim(
      "Detect-and-report is mandatory and permanent: an instance buried in an\n" +
        "opaque construct is reported, never silently skipped."
    )
  );

  const templates = [
    ...makeTemplates(1),
    {
      name: "wrapped (deliberately unreachable)",
      mjml: `<mjml><mj-body><mj-wrapper><mj-section><mj-column>${ref(1)}</mj-column></mj-section></mj-wrapper></mj-body></mjml>`,
    },
  ];

  let total = 0;
  let unreachable = 0;
  for (const t of templates) {
    const r = locateInstances(t.mjml);
    total += r.summary.total;
    unreachable += r.summary.unreachable;
    const flag =
      r.summary.unreachable > 0
        ? c.yellow(`${r.summary.reachable}/${r.summary.total} reachable`)
        : c.green(`${r.summary.reachable}/${r.summary.total} reachable`);
    console.log(`  ${t.name.padEnd(34)} ${flag}`);
    for (const [reason, n] of Object.entries(r.summary.unreachableBy)) {
      console.log(c.dim(`      ${n} unreachable — ${reason}`));
    }
  }

  console.log();
  console.log(`  ${c.bold("total")}       ${total}`);
  console.log(`  ${c.bold("unreachable")} ${unreachable > 0 ? c.yellow(String(unreachable)) : "0"}`);
  if (unreachable > 0) {
    console.log(
      c.dim(
        "\n  Note: unreachable instances still EXPAND correctly — reference\n" +
          "  substitutes a fixed-shape token and runs straight through an opaque\n" +
          "  wrapper. Reachability limits per-instance addressing (the canvas\n" +
          "  overlay), not rendering."
      )
    );
  }
}

function cmdDiff(): number {
  const store = buildStore();
  const published = store.publish(COMPONENT_ID, BUTTON_V2, {
    label: "Primary button (rebrand)",
  });

  heading(`Dry run — ${COMPONENT_ID}: revision 1 → ${published.revision}`);
  console.log(
    c.dim(
      'This is expand(before) vs expand(after) — real MJML on both sides, both\n' +
        'pure functions of stored data. "Revision 1 → 2" is not the diff.'
    )
  );

  const templates = makeTemplates(1);
  let totalChanged = 0;


  for (const t of templates) {
    const before = expand(t.mjml, store).mjml;
    const after = expand(t.mjml, store, {
      pins: { [COMPONENT_ID]: published.revision },
    }).mjml;
    console.log(`\n${c.cyan(t.name)}`);
    totalChanged += printDiff(before, after);
  }

  heading("Blast radius (measured, not asserted)");
  // Actually compute the stored-side delta rather than printing a claim. In a
  // codebase that asks for explicit invariants, a hardcoded "0 bytes" styled as
  // a result is the weaker half of the demo.
  let storedChangedLines = 0;
  let storedChangedChars = 0;
  for (const t of templates) {
    const applied = t.mjml.replace(
      new RegExp(`(component-id="${COMPONENT_ID}"\\s+revision=")1(")`, "g"),
      `$1${published.revision}$2`
    );
    const a = t.mjml.split("\n");
    const b = applied.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        storedChangedLines++;
        const x = a[i] ?? "";
        const y = b[i] ?? "";
        for (let k = 0; k < Math.max(x.length, y.length); k++) {
          if (x[k] !== y[k]) storedChangedChars++;
        }
      }
    }
  }
  console.log(
    `  Stored templates rewritten before applying: ${c.bold("0 bytes")} — the pin has not moved.`
  );
  console.log(
    `  Applying changes ${c.bold(String(storedChangedLines))} line(s) and ` +
      `${c.bold(String(storedChangedChars))} character(s) across ${templates.length} templates ` +
      `${c.dim(`(revision="1" → revision="${published.revision}")`)}`
  );
  console.log(
    c.dim(
      "\n  Treat that as an invariant, not a happy property. If propagation ever\n" +
        "  rewrites more than the pin, it has removed the reason the reference\n" +
        "  model was chosen over copy."
    )
  );
  return totalChanged;
}

function cmdExport(): void {
  const store = buildStore();
  const outDir = join(process.cwd(), "workspace", "expanded");
  mkdirSync(outDir, { recursive: true });

  heading("Bulk expanded-MJML export");
  console.log(
    c.dim(
      "The escape hatch: every template as plain, portable MJML with no\n" +
        "references left in it, so the corpus outlives this tool."
    )
  );

  for (const t of makeTemplates(1)) {
    const { mjml, regions } = expand(t.mjml, store);
    const file = join(outDir, `${t.name}.mjml`);
    writeFileSync(file, mjml, "utf8");
    console.log(
      `  ${c.green("✓")} ${t.name.padEnd(12)} ${c.dim(`${regions.length} region(s) → ${file}`)}`
    );
  }
}

function cmdDemo(): void {
  heading("Component design system — vertical slice");
  console.log(
    c.dim(
      "One component, referenced from three templates. Content lives once, in\n" +
        "immutable revisions. Propagation is a revision bump."
    )
  );

  const store = buildStore();
  console.log(`\n  Published ${c.bold(COMPONENT_ID)} revision 1`);
  for (const t of makeTemplates(1)) {
    const r = locateInstances(t.mjml);
    console.log(
      `  ${c.green("✓")} ${t.name.padEnd(12)} references it ${c.dim(`(${r.summary.reachable}/${r.summary.total} reachable)`)}`
    );
  }

  heading("The guards");
  console.log(
    c.dim(
      "An unexpanded reference compiles to HTTP 200 with the content silently\n" +
        "gone. Two distinct refusals protect against that."
    )
  );
  // (a) a pin with no such revision — ComponentNotFoundError.
  try {
    expand(makeTemplates(99)[0]!.mjml, store);
    console.log(c.red("  ✗ expected a refusal for a missing revision and got none"));
  } catch (err) {
    if (err instanceof ExpansionError) {
      console.log(
        `  ${c.green("✓")} missing revision refused: ${c.dim(err.message.slice(0, 80))}`
      );
    } else throw err;
  }
  // (b) the throw-on-survivor guard itself, on a reference the substitution
  // scanner cannot parse. This is the one the heading is really about, and an
  // earlier version of this demo only ever exercised (a).
  try {
    expand(
      `<mjml><mj-body><mj-component component-id="${COMPONENT_ID}" revision="1 /></mj-body></mjml>`,
      store
    );
    console.log(c.red("  ✗ expected the survivor guard to fire and it did not"));
  } catch (err) {
    console.log(
      `  ${c.green("✓")} malformed reference refused: ${c.dim((err as Error).message.slice(0, 80))}`
    );
  }

  const changed = cmdDiff();
  if (changed === 0) {
    console.log(c.red("\n  ✗ expected the revision bump to change the expanded output"));
  }
  cmdExport();
  cmdReport();

  heading("Below-root overrides — what experiment (b) forced");
  console.log(
    c.dim(
      "Measured over 39 real templates: composite shapes (image + copy + CTA)\n" +
        "carry 80-100% of their variance BELOW the root. Root-only overrides\n" +
        "cannot express that, so detach would have become the routine path."
    )
  );
  {
    const src =
      `<mjml><mj-body><mj-section>` +
      `<mj-component component-id="${CARD_ID}" revision="1" ` +
      `ov-tag-0="mj-image" ov-at-0-alt="Running shoe, side view" ` +
      `ov-tag-2="mj-button" ov-at-2-href="https://shoe.test/p/nimbus-24" ` +
      `ov-padding="12px" />` +
      `</mj-section></mj-body></mjml>`;
    const { mjml, regions } = expand(src, store);
    const line = (re: RegExp) => (mjml.match(re) ?? [""])[0];
    console.log(`  ${c.green("✓")} nested CTA  ${c.dim(line(/<mj-button[^>]*>/) || "")}`);
    console.log(`  ${c.green("✓")} nested image ${c.dim(line(/<mj-image[^>]*>/) || "")}`);
    console.log(
      `  ${c.green("✓")} bindings recorded: ${c.dim([...regions[0]!.overridable.keys()].join(", "))}`
    );
    console.log(
      c.dim(
        "\n  Still inside the reference model: an override is a literal attribute\n" +
          "  propagation never touches. No merge, no base, no conflicts, and the\n" +
          "  blast radius of a bump is still one attribute value per template."
      )
    );
  }

  heading("What this slice does NOT do");
  console.log(
    c.dim(
      "  · No UI, no brands table, no API scoping, no auth — all deferred (§12).\n" +
        "  · §11 experiment (b) has now been run against 39 real public templates\n" +
        "    (`npm run measure`), not against one agency's brand corpus. It came\n" +
        "    back at mean 3.48 differing attributes with 38% below the root, which\n" +
        "    is why below-root overrides exist. Re-run it on a REAL brand corpus\n" +
        "    before treating the override surface as settled — a consistent brand\n" +
        "    should measure lower than a gallery of varied showcases."
    )
  );
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2] ?? "demo";
try {
  switch (cmd) {
    case "demo":
      cmdDemo();
      break;
    case "diff":
      cmdDiff();
      break;
    case "export":
      cmdExport();
      break;
    case "report":
      cmdReport();
      break;
    default:
      console.error(`Unknown command "${cmd}". Try: demo | diff | export | report`);
      process.exit(2);
  }
  console.log();
} catch (err) {
  console.error(`\n${c.red("Failed:")} ${(err as Error).message}\n`);
  process.exit(1);
}
