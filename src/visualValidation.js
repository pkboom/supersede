import { spawn } from "node:child_process";
import fs, { createReadStream } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFragment } from "parse5";
import { DEFAULT_MODEL, runLunaJson } from "./luna.js";

const VISUAL_SCHEMA = {
  type: "object",
  properties: {
    status: { enum: ["pass", "fail", "review"] },
    summary: { type: "string" },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary", "concerns"],
  additionalProperties: false,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
    });
  });
}

function playwrightCommand(session) {
  const wrapper = path.join(os.homedir(), ".codex", "skills", "playwright", "scripts", "playwright_cli.sh");
  if (fs.existsSync(wrapper)) return { command: wrapper, prefix: ["--json", `-s=${session}`] };
  return {
    command: "npx",
    prefix: ["--yes", "--package", "@playwright/cli", "playwright-cli", "--json", `-s=${session}`],
  };
}

async function startStaticServer(before, after) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const match = pathname.match(/^\/(before|after)\/(.*)$/u);
    if (!match) {
      response.writeHead(404).end("Not found");
      return;
    }
    const root = match[1] === "before" ? before : after;
    const relative = match[2].split("/").map(decodeURIComponent).join(path.sep);
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(filePath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === ".html" || extension === ".htm"
      ? "text/html; charset=utf-8"
      : extension === ".png"
        ? "image/png"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : "application/octet-stream";
    response.writeHead(200, {
      "content-type": contentType,
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; script-src 'none'; connect-src 'none'",
    });
    createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: server.address().port };
}

function imagePath(root, side, file) {
  const parsed = path.parse(file);
  return path.join(root, "captures", side, parsed.dir, `${parsed.name}.png`);
}

function visibleText(rawHtml) {
  const fragment = parseFragment(rawHtml);
  let text = "";
  const visit = (node) => {
    if (node.nodeName === "#text") text += node.value;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(fragment);
  return text.replace(/\s+/gu, " ").trim();
}

function contextText(edit) {
  const raw = edit.context?.match(/ text=(.+)$/u)?.[1];
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return "";
  }
}

async function captureChangedDetails(invoke, side, file, edits, artifacts) {
  const images = [];
  for (let index = 0; index < Math.min(edits.length, 16); index += 1) {
    const edit = edits[index];
    const value = side === "before" ? edit.before : edit.replacement;
    const parsed = path.parse(file);
    const destination = path.join(
      artifacts,
      "captures",
      `${side}-details`,
      parsed.dir,
      `${parsed.name}-${index + 1}.png`,
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (edit.kind === "text") {
      const needle = visibleText(value);
      if (!needle) continue;
      await invoke(
        "run-code",
        `async (page) => { const matches = page.locator('body *').filter({hasText: ${JSON.stringify(needle)}}); const count = await matches.count(); if (count) { const target = matches.nth(count - 1); await target.scrollIntoViewIfNeeded(); await target.screenshot({path: ${JSON.stringify(destination)}, animations: 'disabled'}); } }`,
      );
    } else {
      const label = contextText(edit);
      await invoke(
        "run-code",
        `async (page) => { let matches = page.locator(${JSON.stringify(edit.tagName || "*")}); ${label ? `matches = matches.filter({hasText: ${JSON.stringify(label)}});` : ""} const count = await matches.count(); for (let i = 0; i < count; i++) { const target = matches.nth(i); if (await target.getAttribute(${JSON.stringify(edit.attributeName)}) === ${JSON.stringify(value)}) { await target.scrollIntoViewIfNeeded(); await target.screenshot({path: ${JSON.stringify(destination)}, animations: 'disabled'}); break; } } }`,
      );
    }
    if (fs.existsSync(destination)) images.push(destination);
  }
  return images;
}

export async function captureEmailPairs(beforeDirectory, afterDirectory, files, artifactsDirectory, plan) {
  if (!files.length) return [];
  const before = path.resolve(beforeDirectory);
  const after = path.resolve(afterDirectory);
  const artifacts = path.resolve(artifactsDirectory);
  const { server, port } = await startStaticServer(before, after);
  const session = `email-validation-${randomUUID()}`;
  const cli = playwrightCommand(session);
  const invoke = (...args) => run(cli.command, [...cli.prefix, ...args], { cwd: artifacts });
  const url = (side, file) =>
    `http://127.0.0.1:${port}/${side}/${file.split(path.sep).map(encodeURIComponent).join("/")}`;
  const captures = [];
  const plans = new Map(plan.files.map((filePlan) => [filePlan.file, filePlan]));
  try {
    await invoke("open", url("before", files[0]));
    await invoke("resize", "800", "1200");
    for (const file of files) {
      const beforeImage = imagePath(artifacts, "before", file);
      const afterImage = imagePath(artifacts, "after", file);
      fs.mkdirSync(path.dirname(beforeImage), { recursive: true });
      fs.mkdirSync(path.dirname(afterImage), { recursive: true });
      await invoke("goto", url("before", file));
      await invoke(
        "run-code",
        `async (page) => { await page.waitForTimeout(600); await page.screenshot({path: ${JSON.stringify(beforeImage)}, fullPage: true, animations: 'disabled'}); }`,
      );
      const beforeDetailImages = await captureChangedDetails(
        invoke,
        "before",
        file,
        plans.get(file).edits,
        artifacts,
      );
      await invoke("goto", url("after", file));
      await invoke(
        "run-code",
        `async (page) => { await page.waitForTimeout(600); await page.screenshot({path: ${JSON.stringify(afterImage)}, fullPage: true, animations: 'disabled'}); }`,
      );
      const afterDetailImages = await captureChangedDetails(
        invoke,
        "after",
        file,
        plans.get(file).edits,
        artifacts,
      );
      captures.push({
        file,
        beforeImage,
        afterImage,
        beforeDetailImages,
        afterDetailImages,
        expectedDetailImages: plans.get(file).edits.length,
      });
    }
  } finally {
    await invoke("close").catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
  return captures;
}

export async function validateCaptureWithLuna({
  file,
  instruction,
  beforeImage,
  afterImage,
  beforeDetailImages = [],
  afterDetailImages = [],
  edits,
  model = DEFAULT_MODEL,
  runLuna = runLunaJson,
}) {
  const prompt = `Validate a requested HTML email change using browser captures. Images are ordered: full BEFORE, full AFTER, then focused BEFORE crops, then focused AFTER crops. Focused crops correspond to changed text targets in the same order.

File: ${file}
Requested change: ${instruction}
Deterministically applied source edits: ${JSON.stringify(edits.map((edit) => ({ before: edit.before, after: edit.replacement, reason: edit.reason })))}

Return pass only if the requested change appears correct and there is no visible unintended layout/content regression. Return fail for a clear error. Return review when browser captures cannot establish correctness, including changes that are not visually observable. Do not assume browser rendering proves Outlook-specific behavior.`;
  const response = await runLuna({
    prompt,
    schema: VISUAL_SCHEMA,
    images: [beforeImage, afterImage, ...beforeDetailImages, ...afterDetailImages],
    model,
  });
  if (
    !response ||
    !["pass", "fail", "review"].includes(response.status) ||
    typeof response.summary !== "string" ||
    !Array.isArray(response.concerns) ||
    response.concerns.some((concern) => typeof concern !== "string")
  ) {
    throw new Error(`Luna returned an invalid visual verdict for ${file}.`);
  }
  return { file, ...response };
}
