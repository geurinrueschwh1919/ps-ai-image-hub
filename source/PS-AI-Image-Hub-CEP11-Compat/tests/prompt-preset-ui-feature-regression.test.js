"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panelPath = path.resolve(__dirname, "../client/js/ui/promptPresetPanel.js");
const panel = fs.readFileSync(panelPath, "utf8");

test("complete Prompt Preset UI baseline remains present", () => {
  const requiredIds = [
    "prompt-preset-search", "prompt-preset-category", "prompt-preset-select", "prompt-preset-recent",
    "prompt-preset-favorite", "prompt-preset-type", "prompt-preset-add", "prompt-preset-display-name",
    "prompt-preset-rename", "prompt-preset-reset-name", "prompt-preset-import", "prompt-preset-import-zip",
    "prompt-preset-export", "prompt-preset-export-all", "prompt-preset-remove", "prompt-preset-restore-factory",
    "prompt-preset-stack", "prompt-preset-apply-mode", "prompt-preset-apply"
  ];
  requiredIds.forEach((id) => assert.match(panel, new RegExp('id=["\\\']' + id + '["\\\']'), id));
});

test("complete Prompt Preset behavior baseline remains wired", () => {
  ["refreshCategories", "refreshRecent", "toggleFavorite", "addCurrentToStack", "renameCurrent", "resetCurrentName",
    "importJson", "importZip", "exportCurrent", "exportAll", "removeCurrent", "restoreFactories", "applyCurrent",
    "createPromptPresetSearchDebounce", "PROMPT_PRESET_FAVORITES_CATEGORY_KEY"]
    .forEach((marker) => assert.match(panel, new RegExp(marker), marker));
  assert.match(panel, /searchDebounceMs[^\n]+200/);
  assert.match(panel, /compilePromptPresetStack/);
  assert.match(panel, /writePresetToPrompt/);
});
