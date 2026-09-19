import { input } from "@inquirer/prompts";
import { realpathSync } from "node:fs";
import path from "node:path";
import yargs from "yargs/yargs";
import { DEFAULT_MODEL } from "../src/luna.js";
import { splitRequestWithLuna } from "../src/pipeline/splitRequest.js";

export async function main({ instruction, model = DEFAULT_MODEL, runLuna } = {}) {
  const request = instruction || await input({
    message: "What should I change?",
    required: true,
  });
  const split = await splitRequestWithLuna(request, { model, runLuna });
  console.log({
    request: split.instruction,
    model,
    find: split.find,
    replacement: split.replacement,
    leaks: split.leaks,
  });
  console.log(`\nWhy: ${split.reason}`);
  if (split.leaks) {
    console.log(
      `\nThe find phase carries ${JSON.stringify(split.replacement)}, so extraction would search the email for a value it does not hold yet.`,
    );
  }
  return split;
}

const isMain = process.argv[1] && import.meta.filename === realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  const argv = yargs(process.argv.slice(2)).string(["value1", "value2"]).parse();
  main({ instruction: argv.value1, model: argv.value2 || undefined }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
