import { input } from "@inquirer/prompts";
import autocomplete from "inquirer-autocomplete-standalone";
import fuzzy from "fuzzy";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEmailFile } from "./extractPatternCommand.js";

const descriptions = {
  extractPatternCommand: "Extract the HTML part containing text or a button",
  extractPromptCommand: "Show the extraction prompt without calling Luna",
  validateExtractCommand: "Run the validation.md extract scenarios",
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
  default: "extractPatternCommand",
});

if (["extractPatternCommand", "extractPromptCommand"].includes(answers.command)) {
  answers.value1 = await input({
    message: "Requested item?",
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
