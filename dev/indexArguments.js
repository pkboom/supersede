import { input } from "@inquirer/prompts";
import autocomplete from "inquirer-autocomplete-standalone";
import fuzzy from "fuzzy";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEmailFile } from "./extractElementCommand.js";

const descriptions = {
  extractElementCommand: "Extract the element carrying the change",
  narrowChangeCommand: "Narrow the element to a deterministic change span",
  requestedItemCommand: "Turn a free-form request into the item to extract",
  requestedItemPromptCommand: "Show the requested-item prompt without calling Luna",
  extractElementPromptCommand: "Show the extract-element prompt without calling Luna",
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
  default: "extractElementCommand",
});

if (answers.command === "narrowChangeCommand") {
  answers.value1 = await input({
    message: "What do you want to update?",
    required: true,
  });
  answers.value2 = await input({
    message: "Workspace folder?",
    default: path.join(path.dirname(devDir), "workspace", "delta"),
  });
}

if (["requestedItemCommand", "requestedItemPromptCommand"].includes(answers.command)) {
  answers.value1 = await input({
    message: "What do you want to update?",
    required: true,
  });
  answers.value2 = await input({
    message: "Email file?",
    default: defaultEmailFile,
  });
}

if (["extractElementCommand", "extractElementPromptCommand"].includes(answers.command)) {
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
