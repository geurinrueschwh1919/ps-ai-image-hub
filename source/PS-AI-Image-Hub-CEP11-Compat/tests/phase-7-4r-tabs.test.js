"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("panel defines Generate, Settings, and History tabs in one CEP panel", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  ["tab-generate", "tab-settings", "tab-history"].forEach((id) => assert.match(source, new RegExp(id)));
  assert.match(source, /TAB_IDS.*generate.*settings.*history/);
});

test("tab switching preserves mounted generation state by hiding panels only", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  const method = source.slice(source.indexOf("activateTab(tabId)"), source.indexOf("handlePipelineStatus", source.indexOf("activateTab(tabId)")));
  assert.match(method, /panel\.hidden/);
  assert.doesNotMatch(method, /innerHTML|mount\s*\(/);
});

test("260px panel and dark dropdown styling remain present with tab layout", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../client/css/main.css"), "utf8");
  assert.match(css, /min-width:\s*260px/); assert.match(css, /\.tab-bar/); assert.match(css, /\.dark-select-menu/); assert.match(css, /#242424/);
});
