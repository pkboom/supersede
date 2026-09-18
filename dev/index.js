import { execFileSync } from "node:child_process";
import path from "node:path";
import { args } from "./indexArguments.js";

const command = path.join(args.devDir, `${args.command}.js`);
const options = [
  "--value1",
  String(args.value1 ?? ""),
  "--value2",
  String(args.value2 ?? ""),
  "--value3",
  String(args.value3 ?? ""),
  "--devDir",
  args.devDir,
];

console.log([process.execPath, command, ...options].join(" "));
execFileSync(process.execPath, [command, ...options], { stdio: "inherit" });
