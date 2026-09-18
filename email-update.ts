import fs from "node:fs";
import path from "node:path";

const MODES = ["address", "buttons", "both"] as const;

type Mode = (typeof MODES)[number];

type Status = "NO_CHANGE" | "CHANGED" | "REVIEW";

interface AddressRule {
  from: string;
  to: string;
}

interface TransformReport {
  addressEdits: number;
  colorEdits: number;
  matchedButtons: number;
  reviewRequired: boolean;
}

interface ReportRow extends TransformReport {
  file: string;
  status: Status;
  /** False for dry runs and for REVIEW files, whose edits were counted but never written. */
  applied: boolean;
}

const RULES: {
  addresses: AddressRule[];
  buttonClasses: string[];
  oldColor: string;
  newColor: string;
} = {
  addresses: [
    {
      from: "123 Old Street, Toronto, ON M1M 1M1",
      to: "456 New Street, Toronto, ON M2M 2M2",
    },
    {
      from: "123 Old Street<br>Toronto, ON M1M 1M1",
      to: "456 New Street<br>Toronto, ON M2M 2M2",
    },
  ],

  // Replace these with classes actually found in the customer's templates.
  buttonClasses: ["primary-cta", "button-cell"],

  oldColor: "#0066cc",
  newColor: "#E31837",
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every whitespace run in `value` matches any whitespace run in the source.
 * Templates wrap addresses across lines and indent them; an exact-string match
 * skips those silently, which is the one failure this tool must not have.
 */
function whitespaceTolerantPattern(value: string): string {
  return value.split(/\s+/).filter(Boolean).map(escapeRegex).join("\\s+");
}

function replaceAddresses(source: string): { html: string; edits: number } {
  let html = source;
  let edits = 0;

  for (const rule of RULES.addresses) {
    const regex = new RegExp(whitespaceTolerantPattern(rule.from), "g");

    // A function replacement, so `$&` and friends in `to` stay literal.
    html = html.replace(regex, () => {
      edits += 1;
      return rule.to;
    });
  }

  return {
    html,
    edits,
  };
}

/**
 * Quoted segments may hold `>`, so they are consumed whole. A bare `<` never
 * appears inside a real tag, and excluding it stops an unterminated quote in
 * malformed HTML from swallowing the rest of the document.
 */
const TAG_REGEX = /<(?:a|td|button)\b(?:"[^"<]*"|'[^'<]*'|[^>"'<])*>/gi;

const ATTRIBUTE_REGEX = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(rawTag: string): Map<string, string> {
  const attrs = new Map<string, string>();

  // Skip `<tagname` so the tag name is not read as an attribute.
  const body = rawTag.replace(/^<[^\s/>]*/, "");

  const regex = new RegExp(ATTRIBUTE_REGEX.source, "g");

  let match: RegExpExecArray | null;

  while ((match = regex.exec(body))) {
    const name = match[1].toLowerCase();

    const value = match[2] ?? match[3] ?? match[4] ?? "";

    attrs.set(name, value);
  }

  return attrs;
}

function hasConfiguredButtonClass(attrs: Map<string, string>): boolean {
  const classes = (attrs.get("class") ?? "").split(/\s+/).filter(Boolean);

  return classes.some((name) => RULES.buttonClasses.includes(name));
}

/** Rejects a longer hex token such as `#0066ccff`, which is a different color. */
const COLOR_END = "(?![0-9a-f])";

function replaceColorInStyle(style: string): { style: string; edits: number } {
  let edits = 0;

  const oldColor = escapeRegex(RULES.oldColor);

  const regex = new RegExp(`(background(?:-color)?\\s*:\\s*)${oldColor}${COLOR_END}`, "gi");

  const updated = style.replace(regex, (_match, prefix: string) => {
    edits += 1;
    return `${prefix}${RULES.newColor}`;
  });

  return {
    style: updated,
    edits,
  };
}

function replaceButtonColors(source: string): {
  html: string;
  edits: number;
  matchedButtons: number;
  reviewRequired: boolean;
} {
  let edits = 0;
  let matchedButtons = 0;
  let reviewRequired = false;

  // Outlook VML buttons need special handling.
  if (/<\s*v:/i.test(source) || /urn:schemas-microsoft-com:vml/i.test(source)) {
    reviewRequired = true;
  }

  const tagRegex = new RegExp(TAG_REGEX.source, "gi");

  const html = source.replace(tagRegex, (rawTag: string) => {
    const attrs = parseAttributes(rawTag);

    if (!hasConfiguredButtonClass(attrs)) {
      return rawTag;
    }

    matchedButtons += 1;

    let updatedTag = rawTag;
    let localEdits = 0;

    /*
     * Update bgcolor="#0066cc". The quote is optional and left unconsumed:
     * old templates write the attribute bare.
     */
    const bgcolorRegex = new RegExp(
      `(bgcolor\\s*=\\s*["']?)${escapeRegex(RULES.oldColor)}${COLOR_END}`,
      "gi"
    );

    updatedTag = updatedTag.replace(bgcolorRegex, (_match, prefix: string) => {
      localEdits += 1;
      return `${prefix}${RULES.newColor}`;
    });

    /*
     * Update style="background-color:#0066cc"
     */
    updatedTag = updatedTag.replace(
      /style\s*=\s*(["'])(.*?)\1/i,
      (_fullMatch, quote: string, styleValue: string) => {
        const result = replaceColorInStyle(styleValue);

        localEdits += result.edits;

        return `style=${quote}${result.style}${quote}`;
      }
    );

    edits += localEdits;

    return updatedTag;
  });

  return {
    html,
    edits,
    matchedButtons,
    reviewRequired,
  };
}

function transform(source: string, mode: Mode = "both"): { html: string; report: TransformReport } {
  let html = source;

  const report: TransformReport = {
    addressEdits: 0,
    colorEdits: 0,
    matchedButtons: 0,
    reviewRequired: false,
  };

  if (mode === "address" || mode === "both") {
    const result = replaceAddresses(html);

    html = result.html;
    report.addressEdits = result.edits;
  }

  if (mode === "buttons" || mode === "both") {
    const result = replaceButtonColors(html);

    html = result.html;
    report.colorEdits = result.edits;
    report.matchedButtons = result.matchedButtons;
    report.reviewRequired = result.reviewRequired;
  }

  return {
    html,
    report,
  };
}

function walkDirectory(directory: string): { files: string[]; symlinks: string[] } {
  const files: string[] = [];
  const symlinks: string[] = [];

  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, {
      withFileTypes: true,
    })) {
      const fullPath = path.join(current, entry.name);

      if (entry.isSymbolicLink()) {
        symlinks.push(fullPath);
      } else if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  visit(directory);

  return {
    files: files.sort(),
    symlinks,
  };
}

function copyFileCreatingDirectories(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), {
    recursive: true,
  });

  fs.copyFileSync(source, destination);
}

function writeFileCreatingDirectories(destination: string, content: string): void {
  fs.mkdirSync(path.dirname(destination), {
    recursive: true,
  });

  fs.writeFileSync(destination, content, "utf8");
}

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

const USAGE = `
Usage:

  npx tsx email-update.ts INPUT OUTPUT [options]

Examples:

  npx tsx email-update.ts ./original ./updated
  npx tsx email-update.ts ./original ./updated --mode address
  npx tsx email-update.ts ./original ./updated --mode buttons
  npx tsx email-update.ts ./original ./updated --mode both --apply

Options:

  --mode address
  --mode buttons
  --mode both
  --apply
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(USAGE);

    process.exit(1);
  }

  const inputDir = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);

  let mode: Mode = "both";
  let apply = false;

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--mode") {
      const value = args[i + 1];

      if (value === undefined || !isMode(value)) {
        throw new Error("--mode must be address, buttons, or both.");
      }

      mode = value;
      i += 1;
      continue;
    }

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    // Never ignore an unknown flag: a typo'd --apply would silently dry-run.
    throw new Error(`Unknown option: ${arg}${USAGE}`);
  }

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  if (apply && fs.existsSync(outputDir)) {
    throw new Error(`Output already exists: ${outputDir}`);
  }

  const { files, symlinks } = walkDirectory(inputDir);

  for (const symlink of symlinks) {
    console.log(`SKIPPED symlink: ${path.relative(inputDir, symlink)}`);
  }

  const report: ReportRow[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(inputDir, filePath);

    const outputPath = path.join(outputDir, relativePath);

    const extension = path.extname(filePath).toLowerCase();

    if (extension !== ".html" && extension !== ".htm") {
      if (apply) {
        copyFileCreatingDirectories(filePath, outputPath);
      }

      continue;
    }

    const original = fs.readFileSync(filePath, "utf8");

    const result = transform(original, mode);

    let status: Status = "NO_CHANGE";

    if (result.report.reviewRequired) {
      status = "REVIEW";
    } else if (result.html !== original) {
      status = "CHANGED";
    }

    const row: ReportRow = {
      file: relativePath,
      status,
      applied: apply && status !== "REVIEW",
      ...result.report,
    };

    report.push(row);

    console.log(row);

    if (apply) {
      /*
       * REVIEW files remain unchanged.
       */
      const content = status === "REVIEW" ? original : result.html;

      writeFileCreatingDirectories(outputPath, content);
    }
  }

  if (apply) {
    fs.mkdirSync(outputDir, {
      recursive: true,
    });

    fs.writeFileSync(path.join(outputDir, "_batch_report.json"), JSON.stringify(report, null, 2));

    console.log(`\nApplied changes to: ${outputDir}`);
  } else {
    console.log("\nDRY RUN only. No files were written.");
  }

  const summary = new Map<Status, number>();

  for (const row of report) {
    summary.set(row.status, (summary.get(row.status) ?? 0) + 1);
  }

  console.log("\nSummary:");
  console.log(Object.fromEntries(summary));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
