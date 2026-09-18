import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyMaterializedEdits, decodeHtml, sha256 } from "./htmlTargets.js";
import { imagePresence } from "./imagePresence.js";
import { findSharedPatternWithLuna, extractSingleWithLuna, matchPattern } from "./patternAgent.js";
import { runPatternLoop } from "./patternLoop.js";
import { captureEmailPairs, validateCaptureWithLuna } from "./visualValidation.js";
import { DEFAULT_MODEL } from "./luna.js";

const EXCLUDED_DIRECTORIES = new Set([".git", ".omc", ".omx", "node_modules"]);

function walkDirectory(directory) {
  const files = [];
  const symlinks = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) symlinks.push(fullPath);
      else if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(directory);
  return { files: files.sort(), symlinks: symlinks.sort() };
}

function isHtml(file) {
  return [".html", ".htm"].includes(path.extname(file).toLowerCase());
}

function safeArtifactName(file) {
  return file.replace(/[^a-z0-9._-]+/giu, "_");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function appendEvidence(artifacts, value) {
  fs.appendFileSync(path.join(artifacts, "evidence.jsonl"), `${JSON.stringify(value)}\n`);
}

function copyInput(input, destination) {
  fs.cpSync(input, destination, {
    recursive: true,
    dereference: false,
    force: false,
    errorOnExist: true,
    filter: (source) => source === input || !EXCLUDED_DIRECTORIES.has(path.basename(source)),
  });
}

function writeHtml(root, file, html) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, html, "utf8");
}

export function visualEvidence(pattern, capture) {
  if (!pattern) return { status: "not_applicable", comparisons: [] };
  const beforeDetails = capture.beforeDetailImages ?? [];
  const afterDetails = capture.afterDetailImages ?? [];
  if (!pattern.visual) {
    if (
      capture.expectedDetailImages > 16 ||
      beforeDetails.length !== capture.expectedDetailImages ||
      afterDetails.length !== capture.expectedDetailImages
    ) {
      return { status: "unestablished", comparisons: [], reason: "no_changed_region_capture" };
    }
    return {
      status: "seeded",
      comparisons: [],
      seed: { beforeTemplates: [...beforeDetails], afterTemplates: [...afterDetails] },
    };
  }
  const comparisons = [];
  if (beforeDetails.length !== capture.expectedDetailImages || afterDetails.length !== capture.expectedDetailImages) {
    return { status: "unestablished", comparisons, reason: "incomplete_changed_region_capture" };
  }
  for (const template of pattern.visual.beforeTemplates) {
    comparisons.push({ side: "before", template, ...imagePresence(template, capture.beforeImage) });
  }
  for (const template of pattern.visual.afterTemplates) {
    comparisons.push({ side: "after", template, ...imagePresence(template, capture.afterImage) });
  }
  if (comparisons.some((comparison) => comparison.status === "absent")) return { status: "fail", comparisons };
  if (comparisons.some((comparison) => comparison.status === "unestablished")) return { status: "unestablished", comparisons };
  return { status: "pass", comparisons };
}

export async function runEmailPatternWorkflow(
  inputDirectory,
  outputDirectory,
  instruction,
  artifactsDirectory,
  options = {},
) {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  const artifacts = path.resolve(artifactsDirectory);
  const model = options.model ?? DEFAULT_MODEL;
  if (!instruction?.trim()) throw new Error("An edit instruction is required.");
  if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) throw new Error(`Input is not a directory: ${input}`);
  if (output === input || isInside(input, output)) throw new Error("Output must not be inside the input directory.");
  if (
    artifacts === input ||
    isInside(input, artifacts) ||
    artifacts === output ||
    isInside(output, artifacts) ||
    isInside(artifacts, output)
  ) {
    throw new Error("Artifacts must be outside the input and output directories.");
  }
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  if (fs.existsSync(artifacts)) throw new Error(`Artifacts already exist: ${artifacts}`);
  const walked = walkDirectory(input);
  if (walked.symlinks.length) throw new Error("Input contains symlinks; refusing an ambiguous batch.");
  const htmlFiles = walked.files.filter(isHtml);
  if (!htmlFiles.length) throw new Error("Input contains no HTML files.");
  const items = htmlFiles.map((filePath) => {
    const id = path.relative(input, filePath);
    const source = decodeHtml(fs.readFileSync(filePath), id);
    return { id, source, sourceSha256: sha256(source) };
  });
  fs.mkdirSync(artifacts, { recursive: true });
  const working = path.join(os.tmpdir(), `email-pattern-working-${process.pid}-${randomUUID()}`);
  let staging = null;
  copyInput(input, working);
  let validationIndex = 0;
  const seedExtractions = new Map();
  const compare = options.compare ?? (async (seed, candidate, previousFailure) => {
    if (!seedExtractions.has(seed.id)) {
      seedExtractions.set(seed.id, await extractSingleWithLuna(seed, instruction, { model }));
    }
    return findSharedPatternWithLuna(seed, candidate, instruction, {
      model,
      feedback: previousFailure?.validation,
      seedExtraction: seedExtractions.get(seed.id),
    });
  });
  const match = options.match ?? ((pattern, item) => Promise.resolve(matchPattern(pattern, item)));
  const extractSingle = options.extractSingle ?? ((item) => extractSingleWithLuna(item, instruction, { model }));

  try {
    const result = await runPatternLoop(items, {
      compare: async (seed, candidate, previousFailure) => {
        const comparison = await compare(seed, candidate, previousFailure);
        appendEvidence(artifacts, { type: "pair_comparison", seed: seed.id, candidate: candidate.id, status: comparison.status });
        return comparison;
      },
      match,
      apply: async (_pattern, item, matched) => ({
        status: "proposed",
        edits: matched.edits,
        html: applyMaterializedEdits(item.source, matched.edits),
      }),
      applySingle: async (item) => {
        const extracted = await extractSingle(item);
        if (extracted.status === "review") return extracted;
        if (extracted.status === "no_change") return { ...extracted, edits: [], html: item.source };
        return {
          status: "review",
          warnings: [
            "A one-off edit was found, but no second email established a shared pattern.",
            ...(extracted.warnings ?? []),
          ],
          proposedEdits: extracted.edits,
        };
      },
      validate: async (item, applied, pattern) => {
        if (applied.status === "review") return { status: "review", concerns: applied.warnings ?? [] };
        validationIndex += 1;
        writeHtml(working, item.id, applied.html);
        const iteration = path.join(
          artifacts,
          "iterations",
          `${String(validationIndex).padStart(4, "0")}-${safeArtifactName(item.id)}`,
        );
        fs.mkdirSync(iteration, { recursive: true });
        const filePlan = { file: item.id, edits: applied.edits };
        try {
          const captures = await (options.capture ?? captureEmailPairs)(input, working, [item.id], iteration, {
            files: [filePlan],
          });
          const capture = captures[0];
          const openCv = (options.visualEvidence ?? visualEvidence)(pattern, capture);
          const luna = await (options.visualValidator ?? validateCaptureWithLuna)({
            ...capture,
            instruction,
            edits: applied.edits,
            model,
          });
          const status = luna.status === "pass" && !["fail", "unestablished"].includes(openCv.status)
            ? "pass"
            : luna.status === "fail" || openCv.status === "fail"
              ? "fail"
              : "review";
          if (status === "pass" && pattern && openCv.seed && !pattern.visual) pattern.visual = openCv.seed;
          const validation = { status, luna, openCv };
          appendEvidence(artifacts, { type: "validation", file: item.id, pattern: pattern?.id ?? null, ...validation });
          if (status !== "pass") writeHtml(working, item.id, item.source);
          return validation;
        } catch (error) {
          writeHtml(working, item.id, item.source);
          throw error;
        }
      },
    }, { maxValidationAttempts: options.maxValidationAttempts ?? 2 });

    const report = {
      version: 1,
      completedAt: new Date().toISOString(),
      instruction,
      model,
      status: result.reviews.length ? "review" : "pass",
      patterns: result.patterns.map((pattern) => ({
        id: pattern.id,
        seedFile: pattern.seedFile,
        partnerFile: pattern.partnerFile,
        rules: pattern.rules,
      })),
      processed: result.processed.map(({ item, applied, validation, pattern }) => ({
        file: item.id,
        sourceSha256: item.sourceSha256,
        outputSha256: sha256(applied.html),
        edits: applied.edits,
        pattern: pattern?.id ?? null,
        validation,
      })),
      reviews: result.reviews.map(({ item, reason, validation }) => ({ file: item.id, reason, validation })),
      events: result.events,
    };
    fs.writeFileSync(path.join(artifacts, "loop-report.json"), JSON.stringify(report, null, 2));
    if (result.reviews.length) return report;
    staging = `${output}.partial-${randomUUID()}`;
    copyInput(working, staging);
    fs.renameSync(staging, output);
    staging = null;
    return report;
  } catch (error) {
    fs.writeFileSync(
      path.join(artifacts, "failure.json"),
      JSON.stringify({ failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }, null, 2),
    );
    throw error;
  } finally {
    fs.rmSync(working, { recursive: true, force: true });
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}
