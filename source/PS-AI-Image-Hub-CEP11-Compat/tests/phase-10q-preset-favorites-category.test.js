"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");
const panelApi = require("../client/js/ui/promptPresetPanel");
const registryApi = require("../client/js/presets/promptPresetRegistry");
const { PromptPresetStore } = require("../client/js/presets/promptPresetStore");
const { PromptPresetStack } = require("../client/js/presets/promptPresetStack");
const { parsePromptPreset } = require("../client/js/presets/promptPresetParser");
const compilerApi = require("../client/js/presets/promptPresetCompiler");

const FAVORITES = "**favorites**";

function translator(dictionary) {
  return function translate(key) { return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key; };
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function preset(id, title, category, factory) {
  return parsePromptPreset({ id, title, category, factory: Boolean(factory), promptTemplate: title + " prompt" }, { trustedFactory: Boolean(factory) });
}

function library(items) {
  const storage = new MemoryStorage(), store = new PromptPresetStore({ storage });
  store.save(items);
  return { storage, store, registry: new registryApi.PromptPresetRegistry({ store }) };
}

function fakeElement(kind) {
  const item = { kind, children: [], value: "", textContent: "", disabled: false, _innerHTML: "",
    appendChild(child) {
      if (child.kind === "fragment") this.children.push.apply(this.children, child.children);
      else this.children.push(child);
      return child;
    } };
  Object.defineProperty(item, "innerHTML", { get() { return this._innerHTML; }, set(value) { this._innerHTML = value; if (value === "") this.children = []; } });
  Object.defineProperty(item, "options", { get() { return this.children; } });
  return item;
}

function withFakeDocument(callback) {
  const original = global.document;
  global.document = { createElement: fakeElement, createDocumentFragment() { return fakeElement("fragment"); } };
  try { return callback(); } finally { global.document = original; }
}

test("FAVORITES-01 virtual category appears after All Categories with reserved internal key", () => withFakeDocument(() => {
  const lib = library([preset("one", "One", "head")]);
  const panel = new panelApi.PromptPresetPanel(null, { registry: lib.registry, t: translator(zhCN) });
  panel.category = fakeElement("select"); panel.category.value = "all";
  panel.refreshCategories();
  assert.equal(panel.category.options[0].value, "all");
  assert.equal(panel.category.options[1].value, FAVORITES);
  assert.equal(panel.category.options[1].textContent, "收藏");
  assert.equal(panel.category.options[2].disabled, true);
  assert.equal(registryApi.PROMPT_PRESET_FAVORITES_CATEGORY_KEY, FAVORITES);
  assert.equal(panelApi.PROMPT_PRESET_FAVORITES_CATEGORY_KEY, FAVORITES);
  assert.equal(translator(enUS)("promptPresetFavoritesCategory"), "Favorites");
}));

test("FAVORITES-02 selecting Favorites includes favorite built-in and imported presets only", () => {
  const lib = library([preset("factory", "Factory", "lighting", true), preset("json", "JSON", "head"), preset("plain", "Plain", "head")]);
  lib.registry.toggleFavorite("factory"); lib.registry.toggleFavorite("json");
  assert.deepEqual(lib.registry.list({ category: FAVORITES }).map((item) => item.id).sort(), ["factory", "json"]);
});

test("FAVORITES-03 Favorites and debounced search use intersection semantics", () => {
  const lib = library([preset("night", "Night Portrait", "portrait"), preset("day", "Day Portrait", "portrait"), preset("other", "Night Light", "lighting")]);
  lib.registry.toggleFavorite("night"); lib.registry.toggleFavorite("day");
  assert.deepEqual(lib.registry.list({ category: FAVORITES, search: "night" }).map((item) => item.id), ["night"]);
  let calls = 0, tasks = {}, nextId = 0;
  const timers = { setTimeout(fn) { const id = ++nextId; tasks[id] = fn; return id; }, clearTimeout(id) { delete tasks[id]; } };
  const handler = panelApi.createPromptPresetSearchDebounce(() => { calls += 1; }, 200, timers);
  "night".split("").forEach((character) => handler(character));
  tasks[Object.keys(tasks)[0]](); assert.equal(calls, 1);
});

test("FAVORITES-04 unfavorite immediately removes the current item while Favorites remains active", () => {
  const lib = library([preset("one", "One", "head")]); lib.registry.toggleFavorite("one");
  const panel = new panelApi.PromptPresetPanel(null, { registry: lib.registry, t: translator(zhCN) });
  panel.currentLibraryPreset = lib.registry.get("one"); panel.category = { value: FAVORITES }; panel.search = { value: "" };
  let visible = null; panel.refreshList = () => { visible = lib.registry.list({ category: panel.category.value, search: panel.search.value }); };
  panel.toggleFavorite();
  assert.equal(visible.length, 0); assert.equal(panel.category.value, FAVORITES);
});

test("FAVORITES-05 favoriting in a real category keeps the current category selected", () => {
  const lib = library([preset("one", "One", "head")]);
  const panel = new panelApi.PromptPresetPanel(null, { registry: lib.registry, t: translator(zhCN) });
  panel.currentLibraryPreset = lib.registry.get("one"); panel.category = { value: "head" }; panel.search = { value: "" };
  panel.refreshList = () => {};
  panel.toggleFavorite();
  assert.equal(panel.category.value, "head"); assert.equal(lib.registry.get("one").favorite, true);
});

test("FAVORITES-06 empty Favorites renders a safe empty-state option without switching category", () => withFakeDocument(() => {
  const lib = library([preset("one", "One", "head")]);
  const panel = new panelApi.PromptPresetPanel(null, { registry: lib.registry, t: translator(zhCN) });
  panel.select = fakeElement("select"); panel.search = { value: "" }; panel.category = { value: FAVORITES };
  panel.selectLibraryPreset = () => {}; panel.refreshRecent = () => {};
  panel.refreshList("");
  assert.equal(panel.select.options.length, 1);
  assert.equal(panel.select.options[0].textContent, "暂无收藏预设");
  assert.equal(panel.category.value, FAVORITES);
}));

test("FAVORITES-07 a real category named 收藏 does not collide with virtual Favorites", () => {
  const lib = library([preset("real", "Real Category", "收藏"), preset("favorite", "Favorite", "head")]);
  lib.registry.toggleFavorite("favorite");
  assert.deepEqual(lib.registry.list({ category: "收藏" }).map((item) => item.id), ["real"]);
  assert.deepEqual(lib.registry.list({ category: FAVORITES }).map((item) => item.id), ["favorite"]);
  assert.ok(lib.registry.categories().includes("收藏"));
});

test("FAVORITES-08 favorite preset can enter Stack and use Replace or Append", () => {
  const lib = library([preset("favorite", "Favorite", "head")]); lib.registry.toggleFavorite("favorite");
  const selected = lib.registry.list({ category: FAVORITES })[0];
  const stack = new PromptPresetStack({ registry: lib.registry, store: lib.store }); stack.add(selected.id);
  const compiled = compilerApi.compilePromptPresetStack(stack.list(), lib.registry, new compilerApi.PromptPresetCompiler()).text;
  assert.equal(compilerApi.applyCompiledPrompt("old", compiled, "replace").text, compiled);
  assert.equal(compilerApi.applyCompiledPrompt("old", compiled, "append").text, "old\n\n" + compiled);
});

test("FAVORITES-09 favorite persistence format remains unchanged after restart", () => {
  const lib = library([preset("one", "One", "head")]); lib.registry.toggleFavorite("one");
  const restarted = new registryApi.PromptPresetRegistry({ store: new PromptPresetStore({ storage: lib.storage }) });
  assert.deepEqual(restarted.list({ category: FAVORITES }).map((item) => item.id), ["one"]);
  assert.equal(restarted.get("one").category, "head");
});
