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
  splitRequestCommand: "Split one typed request into its find and replace phases",
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

if (answers.command === "splitRequestCommand") {
  answers.value1 = await input({
    message: "What should I change?",
    required: true,
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

console.log(answers);

export const args = answers;
