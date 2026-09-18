import { select } from "@inquirer/prompts";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yargs from "yargs/yargs";
import { applyMaterializedEdits, buildAnnotatedView, sha256 } from "../src/htmlTargets.js";
import { extractSingleWithLuna, findSharedPatternWithLuna, matchPattern } from "../src/patternAgent.js";
import { runPatternLoop } from "../src/patternLoop.js";

const EXACT_ADDRESS = "123 Example Street, Springfield, IL 62704";
const SPLIT_ADDRESS = ["123 Example Street", "Springfield, IL 62704"];
const NEW_ADDRESS = "1030 Delta Boulevard, Atlanta, GA 30354";
const BUTTON_COLOUR = "#E51937";
const NEW_BUTTON_COLOUR = "#00529B";

function shell(body) {
  return `<!DOCTYPE html>
<html><body>
<table role="presentation" width="600"><tr><td class="wrap">
${body}
</td></tr></table>
</body></html>`;
}

function exactAddressEmail(heading) {
  return shell(`  <h1>${heading}</h1>
  <td id="Footer" class="darkmode">${EXACT_ADDRESS}</td>`);
}

function splitAddressEmail(heading) {
  return shell(`  <h1>${heading}</h1>
  <td id="Footer" class="darkmode">${SPLIT_ADDRESS[0]}<br>${SPLIT_ADDRESS[1]}</td>`);
}

function buttonEmail(heading, label) {
  return shell(`  <h1>${heading}</h1>
  <table><tr><td class="innertd buttonblock" bgcolor="${BUTTON_COLOUR}">
    <a class="buttonstyles" href="https://example.com/go">${label}</a>
  </td></tr></table>`);
}

function plainEmail(heading) {
  return shell(`  <h1>${heading}</h1>
  <td id="Footer" class="darkmode">No postal address and no button in this email.</td>`);
}

const GROUPS = {
  "exact-text": {
    instruction: `Replace the postal address "${EXACT_ADDRESS}" with "${NEW_ADDRESS}".`,
    found: (heading) => exactAddressEmail(heading),
    missing: (heading) => plainEmail(heading),
    selectTargets: (view) =>
      [...view.targets.values()].filter((target) => target.kind === "text" && target.source.includes("123 Example Street")),
    replacements: () => [NEW_ADDRESS],
  },
  "similar-text": {
    instruction: `Replace the postal address "${SPLIT_ADDRESS.join(" ")}" with "${NEW_ADDRESS}". The source splits the address across a <br>; the new address is one line.`,
    found: (heading) => splitAddressEmail(heading),
    missing: (heading) => plainEmail(heading),
    selectTargets: (view) =>
      [...view.targets.values()].filter(
        (target) => target.kind === "text" && SPLIT_ADDRESS.some((part) => target.source.includes(part)),
      ),
    replacements: () => [NEW_ADDRESS, ""],
  },
  button: {
    instruction: `Change the "${BUTTON_COLOUR}" button background colour to "${NEW_BUTTON_COLOUR}".`,
    found: (heading) => buttonEmail(heading, "TRACK YOUR ORDER"),
    missing: (heading) => plainEmail(heading),
    selectTargets: (view) =>
      [...view.targets.values()].filter(
        (target) => target.kind === "attribute" && target.attributeName === "bgcolor" && target.source === BUTTON_COLOUR,
      ),
    replacements: () => [NEW_BUTTON_COLOUR],
  },
};

const SHAPES = [
  { name: "1 file, found in first", present: [true], expected: { patterns: 0, processed: 0, reviews: 1 } },
  { name: "2 files, found in first and second", present: [true, true], expected: { patterns: 1, processed: 2, reviews: 0 } },
  { name: "2 files, found in first, not in second", present: [true, false], expected: { patterns: 0, processed: 1, reviews: 1 } },
  {
    name: "3 files, found in first, not in second, found in third",
    present: [true, false, true],
    expected: { patterns: 1, processed: 3, reviews: 0 },
  },
];

export const SCENARIOS = Object.keys(GROUPS).flatMap((group) =>
  SHAPES.map((shape) => ({ group, ...shape })),
);

function buildItems(group, shape) {
  const definition = GROUPS[group];
  return shape.present.map((present, index) => {
    const id = `${String(index + 1).padStart(2, "0")}-mail.html`;
    const heading = `Email ${index + 1}`;
    const source = present ? definition.found(heading) : definition.missing(heading);
    return { id, source, sourceSha256: sha256(source) };
  });
}

function offlineEdits(definition, item) {
  const view = buildAnnotatedView(item.source);
  const targets = definition.selectTargets(view);
  if (!targets.length) return { status: "no_change", edits: [], warnings: [] };
  const replacements = definition.replacements();
  return {
    status: "proposed",
    edits: targets.map((target, index) => ({
      targetId: target.id,
      replacement: replacements[Math.min(index, replacements.length - 1)],
      reason: "Deterministic offline selection.",
    })),
    warnings: [],
  };
}

function offlineLuna(definition, seed, candidate) {
  return async ({ schema }) => {
    const statuses = schema.properties.status.enum;
    if (statuses.includes("proposed")) return offlineEdits(definition, seed);
    const seedView = buildAnnotatedView(seed.source);
    const candidateView = buildAnnotatedView(candidate.source);
    const seedTargets = definition.selectTargets(seedView);
    const candidateTargets = definition.selectTargets(candidateView);
    if (!seedTargets.length || seedTargets.length !== candidateTargets.length) {
      return { status: "no_pattern", rules: [], warnings: ["No shared target."] };
    }
    const replacements = definition.replacements();
    return {
      status: "pattern",
      rules: seedTargets.map((target, index) => ({
        role: `role-${index + 1}`,
        seedTargetId: target.id,
        candidateTargetId: candidateTargets[index].id,
        replacement: replacements[Math.min(index, replacements.length - 1)],
        reason: "Deterministic offline selection.",
        match: {
          kind: target.kind,
          tagName: target.tagName ?? "",
          attributeName: target.attributeName ?? "",
          sourceEquals: target.source === candidateTargets[index].source ? target.source : null,
          contextIncludes: [target.context],
        },
      })),
      warnings: [],
    };
  };
}

export async function runScenario(scenario, { live = false } = {}) {
  const definition = GROUPS[scenario.group];
  const items = buildItems(scenario.group, scenario);
  const outputs = new Map();
  const failures = [];

  const result = await runPatternLoop(items, {
    compare: async (seed, candidate) => {
      const runLuna = live ? undefined : offlineLuna(definition, seed, candidate);
      try {
        return await findSharedPatternWithLuna(seed, candidate, definition.instruction, { runLuna });
      } catch (error) {
        failures.push(`compare ${seed.id} x ${candidate.id}: ${error.message}`);
        return { status: "no_pattern", warnings: [error.message] };
      }
    },
    match: async (pattern, item) => matchPattern(pattern, item),
    apply: async (_pattern, item, matched) => ({
      status: "proposed",
      edits: matched.edits,
      html: applyMaterializedEdits(item.source, matched.edits),
    }),
    applySingle: async (item) => {
      const runLuna = live ? undefined : offlineLuna(definition, item, item);
      let extracted;
      try {
        extracted = await extractSingleWithLuna(item, definition.instruction, { runLuna });
      } catch (error) {
        failures.push(`single ${item.id}: ${error.message}`);
        return { status: "review", warnings: [error.message] };
      }
      if (extracted.status === "review") return extracted;
      if (extracted.status === "no_change") return { ...extracted, edits: [], html: item.source };
      return {
        status: "review",
        warnings: ["A one-off edit was found, but no second email established a shared pattern."],
        proposedEdits: extracted.edits,
      };
    },
    validate: async (item, applied) => {
      if (applied.status === "review") return { status: "review", concerns: applied.warnings ?? [] };
      outputs.set(item.id, applied.html);
      return { status: "pass" };
    },
  }, { maxValidationAttempts: 1 });

  const actual = {
    patterns: result.patterns.length,
    processed: result.processed.length,
    reviews: result.reviews.length,
  };
  const ok = ["patterns", "processed", "reviews"].every((key) => actual[key] === scenario.expected[key]);
  return { scenario, actual, ok, failures, outputs, patterns: result.patterns };
}

function footerOf(html) {
  return html.match(/<td id="Footer"[^>]*>([\s\S]*?)<\/td>/u)?.[1]
    ?? html.match(/bgcolor="([^"]*)"/u)?.[1]
    ?? "";
}

export async function main({ group = "all", mode = "offline" } = {}) {
  const live = mode === "live";
  const selected = group === "all" ? SCENARIOS : SCENARIOS.filter((scenario) => scenario.group === group);
  let passed = 0;
  for (const scenario of selected) {
    const run = await runScenario(scenario, { live });
    passed += run.ok ? 1 : 0;
    const { patterns, processed, reviews } = run.actual;
    const expected = scenario.expected;
    console.log(`${run.ok ? "PASS" : "FAIL"}  [${scenario.group}] ${scenario.name}`);
    console.log(
      `      patterns ${patterns}/${expected.patterns}  processed ${processed}/${expected.processed}  reviews ${reviews}/${expected.reviews}`,
    );
    for (const [file, html] of run.outputs) {
      const footer = footerOf(html).replace(/\s+/gu, " ").trim();
      if (footer) console.log(`      ${file} -> ${footer}`);
    }
    for (const failure of run.failures) console.log(`      ! ${failure}`);
  }
  console.log(`\n${passed}/${selected.length} scenarios matched expectations (${live ? "live" : "offline"} mode).`);
  if (passed !== selected.length) process.exitCode = 2;
}

async function promptForMissing(values) {
  const group = values.group || await select({
    message: "Which extract scenarios?",
    choices: [
      { name: "all", value: "all" },
      ...Object.keys(GROUPS).map((name) => ({ name, value: name })),
    ],
    default: "all",
  });
  const mode = values.mode || await select({
    message: "Run against Luna?",
    choices: [
      { name: "offline (deterministic, no API cost)", value: "offline" },
      { name: "live (calls the Responses API)", value: "live" },
    ],
    default: "offline",
  });
  return { group, mode };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).parse();
  promptForMissing({ group: argv.value1, mode: argv.value2 })
    .then(main)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
