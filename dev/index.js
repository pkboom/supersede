import { execFileSync } from "node:child_process";
import path from "node:path";
import { args } from "./indexArguments.js";

const command = path.join(args.devDir, `${args.command}.js`);
const options = [
  ["--value1", args.value1],
  ["--value2", args.value2],
  ["--devDir", args.devDir],
]
  .filter(([, value]) => value !== undefined && value !== null && value !== "")
  .flatMap(([flag, value]) => [flag, String(value)]);

const quoted = (value) => (/[\s"'$`\\]/u.test(value) ? JSON.stringify(value) : value);
console.log([process.execPath, command, ...options].map(quoted).join(" "));

try {
  execFileSync(process.execPath, [command, ...options], { stdio: "inherit" });
} catch (error) {
  if (typeof error?.status === "number") {
    process.exitCode = error.status;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
