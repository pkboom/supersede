export function changeSlug(request, index) {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return `${String(index).padStart(3, "0")}-${words || "change"}`;
}

export function buildReplacementScript({ request, from, to, files }) {
  return `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUEST = ${JSON.stringify(request)};
const FROM = ${JSON.stringify(from)};
const TO = ${JSON.stringify(to)};
const FILES = ${JSON.stringify(files, null, 2)};

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

function occurrences(source, needle) {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

console.log(REQUEST);
console.log();

let failed = 0;
for (const name of FILES) {
  const file = path.join(workspace, name);
  const source = fs.readFileSync(file, "utf8");
  const found = occurrences(source, FROM);
  if (found !== 1) {
    console.error(\`  \${name}: refusing, matched \${found} times\`);
    failed += 1;
    continue;
  }
  if (check) {
    console.log(\`  \${name}: would replace\`);
    continue;
  }
  const at = source.indexOf(FROM);
  fs.writeFileSync(file, source.slice(0, at) + TO + source.slice(at + FROM.length), "utf8");
  console.log(\`  \${name}: replaced\`);
}

if (failed) process.exitCode = 1;
`;
}
