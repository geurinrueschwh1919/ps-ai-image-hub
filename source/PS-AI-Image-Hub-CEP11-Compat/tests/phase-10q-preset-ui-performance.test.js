"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");
const panelApi = require("../client/js/ui/promptPresetPanel");
const registryApi = require("../client/js/presets/promptPresetRegistry");
const compilerApi = require("../client/js/presets/promptPresetCompiler");
const { PromptPresetStore } = require("../client/js/presets/promptPresetStore");

function translator(dictionary) {
  return function translate(key) { return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key; };
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function rawPreset(index, category) {
  return { id: "preset-" + index, title: "Preset " + index, category: category || "head",
    subCategory: index % 2 ? "detail" : "portrait", description: "Description " + index,
    tags: ["tag" + index], promptTemplate: "Prompt content " + index };
}

function fixtureRegistry(count) {
  const presets = Array.from({ length: count }, (_, index) => rawPreset(index, index % 2 ? "head" : "lighting"));
  const state = { favorites: [], displayNames: {}, hiddenFactoryPresetIds: [] };
  const store = {
    reads: 0,
    load() { return JSON.parse(JSON.stringify(presets)); },
    loadState() { this.reads += 1; return JSON.parse(JSON.stringify(state)); }
  };
  return { registry: new registryApi.PromptPresetRegistry({ store }), store };
}

test("PRESET-UI-01 Chinese UI maps requested English category keys without changing the keys", () => {
  const t = translator(zhCN);
  const expected = { portrait: "人像", head: "头部", fullbody: "全身", hands: "手部", legs: "腿部", feet: "足部",
    neck: "颈部", arms: "手臂", torso: "躯干", accessory: "配饰", weapon: "武器", cleanup: "清理优化" };
  Object.keys(expected).forEach((key) => {
    const preset = { category: key };
    assert.equal(panelApi.promptPresetCategoryLabel(t, preset.category), expected[key]);
    assert.equal(preset.category, key);
  });
});

test("PRESET-UI-02 English UI keeps imported category names and unknown categories display unchanged", () => {
  const t = translator(enUS);
  ["portrait", "head", "fullbody", "hands", "legs", "feet", "neck", "arms", "torso", "accessory", "weapon", "cleanup"]
    .forEach((key) => assert.equal(panelApi.promptPresetCategoryLabel(t, key), key));
  assert.equal(panelApi.promptPresetCategoryLabel(translator(zhCN), "custom-category"), "custom-category");
});

test("PRESET-UI-03 favorite button labels and tooltips are explicit", () => {
  const t = translator(zhCN);
  assert.deepEqual(panelApi.promptPresetFavoriteButtonState(t, false), { label: "☆ 收藏", title: "将当前预设加入收藏" });
  assert.deepEqual(panelApi.promptPresetFavoriteButtonState(t, true), { label: "★ 已收藏", title: "取消收藏" });
});

test("PRESET-UI-04 favorite persistence data structure is unchanged", () => {
  const storage = new MemoryStorage();
  const store = new PromptPresetStore({ storage });
  store.save([rawPreset(1, "head")]);
  const registry = new registryApi.PromptPresetRegistry({ store });
  assert.equal(registry.toggleFavorite("preset-1"), true);
  const restarted = new registryApi.PromptPresetRegistry({ store: new PromptPresetStore({ storage }) });
  assert.equal(restarted.get("preset-1").favorite, true);
});

test("PRESET-UI-05 200ms debounce collapses ten rapid inputs into one refresh", () => {
  let nextId = 0, calls = 0, pending = {};
  const timers = {
    setTimeout(callback, delay) { const id = ++nextId; pending[id] = { callback, delay }; return id; },
    clearTimeout(id) { delete pending[id]; }
  };
  const debounced = panelApi.createPromptPresetSearchDebounce(() => { calls += 1; }, 200, timers);
  for (let index = 0; index < 10; index += 1) debounced("query-" + index);
  assert.equal(calls, 0); assert.equal(Object.keys(pending).length, 1);
  const task = pending[Object.keys(pending)[0]]; assert.equal(task.delay, 200); task.callback();
  assert.equal(calls, 1);
});

test("PRESET-UI-06 cached search supports 210 presets, content fields, category combination and clear", () => {
  const fixture = fixtureRegistry(210); fixture.store.reads = 0;
  assert.deepEqual(fixture.registry.list({ search: "prompt content 151", category: "head" }).map((item) => item.id), ["preset-151"]);
  assert.equal(fixture.store.reads, 1, "one search should read one state snapshot");
  assert.equal(fixture.registry.list({ search: "prompt content 151", category: "lighting" }).length, 0);
  assert.equal(fixture.registry.list({ search: "prompt content 151", category: "head" }).length, 1);
  assert.equal(fixture.registry.list({ search: "", category: "all" }).length, 210);
});

test("PRESET-UI-07 searching does not normalize, migrate, parse JSON or rebuild the registry", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/presets/promptPresetRegistry.js"), "utf8");
  const listBody = source.slice(source.indexOf("list(options)"), source.indexOf("categories()"));
  assert.doesNotMatch(listBody, /normalizePromptPreset|JSON\.parse|reload\(|rebuildSearchIndex\(|migrat/i);
});

test("PRESET-UI-08 preset dropdown options are batch-built and selected ID is retained", () => {
  const fixture = fixtureRegistry(210), originalDocument = global.document;
  function element(kind) {
    const item = { kind, children: [], value: "", textContent: "", _innerHTML: "",
      appendChild(child) {
        if (child.kind === "fragment") this.children.push.apply(this.children, child.children);
        else this.children.push(child);
        return child;
      } };
    Object.defineProperty(item, "innerHTML", { get() { return this._innerHTML; }, set(value) { this._innerHTML = value; if (value === "") this.children = []; } });
    Object.defineProperty(item, "options", { get() { return this.children; } });
    return item;
  }
  global.document = { createElement: element, createDocumentFragment() { return element("fragment"); } };
  try {
    const panel = new panelApi.PromptPresetPanel(null, { registry: fixture.registry, t: translator(zhCN) });
    panel.select = element("select"); panel.search = { value: "Preset 151" }; panel.category = { value: "head" };
    let selected = ""; panel.selectLibraryPreset = (id) => { selected = id; }; panel.refreshRecent = () => {};
    panel.refreshList("preset-151");
    assert.equal(panel.select.children.length, 2); assert.equal(panel.select.value, "preset-151"); assert.equal(selected, "preset-151");
  } finally { global.document = originalDocument; }
});

test("PRESET-UI-09 Stack and Replace/Append behavior remains unchanged", () => {
  assert.equal(compilerApi.applyCompiledPrompt("old", "new", "replace").text, "new");
  assert.equal(compilerApi.applyCompiledPrompt("old", "new", "append").text, "old\n\nnew");
});
