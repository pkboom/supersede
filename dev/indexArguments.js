import { input } from "@inquirer/prompts";
import autocomplete from "inquirer-autocomplete-standalone";
import fuzzy from "fuzzy";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEmailFile } from "./extractElementCommand.js";

const descriptions = {
  extractElementCommand: "Phase 1 alone: extract the element it names",
  extractElementPromptCommand: "Phase 1 prompt only, without calling Luna",
  narrowChangeCommand: "Both phases: extract, narrow, and check determinism",
  validateExtractCommand: "Run the validateExtract.md scenarios",
};

async function search(options, query = "") {
  return fuzzy.filter(query, options).map(({ original }) => ({
    value: original,
    description: descriptions[original] ? `==> ${descriptions[original]}` : undefined,
  }));
}

const devDir = path.dirname(fileURLToPath(import.meta.url));
const answers = { devDir };

answers.command = await autocomplete({
  message: "What do you want to do?",
  source: async (query = "") => {
    const commands = readdirSync(devDir)
      .filter((file) => file.includes("Command"))
      .map((file) => file.replace(".js", ""))
      .sort();
    return search(commands, query);
  },
  default: "extractElementCommand",
});

if (answers.command === "narrowChangeCommand") {
  answers.value1 = await input({
    message: "What should I find?",
    required: true,
  });
  answers.value3 = await input({
    message: "What should it be replaced with?",
    required: true,
  });
  answers.value2 = await input({
    message: "Workspace folder?",
    default: path.join(path.dirname(devDir), "workspace", "delta"),
  });
}

if (["extractElementCommand", "extractElementPromptCommand"].includes(answers.command)) {
  answers.value1 = await input({
    message: "What should I find?",
    required: true,
  });
  answers.value2 = await input({
    message: "Email file?",
    default: defaultEmailFile,
  });
}

if (answers.command === "validateExtractCommand") {
  answers.value1 = await autocomplete({
    message: "Which extract scenarios?",
    source: async (query = "") => search(["all", "exact-text", "similar-text", "button"], query),
    default: "all",
  });
  answers.value2 = await autocomplete({
    message: "Run against Luna?",
    source: async (query = "") => search(["offline", "live"], query),
    default: "offline",
  });
}

console.log(answers);

export const args = answers;
