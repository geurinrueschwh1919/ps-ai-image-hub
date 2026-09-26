"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const normalizer = require("../client/js/presets/promptPresetNormalizer");
const { PromptPresetStore, PROMPT_PRESET_V2_STORAGE_KEY } = require("../client/js/presets/promptPresetStore");
const zipApi = require("../client/js/presets/promptPresetZip");

class MemoryStorage {
  constructor(initial) { this.values = new Map(Object.entries(initial || {})); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function normalize(value) { return normalizer.normalizePromptPresetCategory(value); }

test("CATEGORY-01 only explicit synonym groups are canonicalized", () => {
  const groups = [
    [["hair", "hairstyle", "毛发", "头发"], "hair"],
    [["lighting", "light", "灯光", "光影"], "lighting"],
    [["face", "facial", "面部", "五官"], "face"],
    [["body", "figure", "身材", "体型"], "body"],
    [["clothes", "clothing", "outfit", "服装"], "clothing"],
    [["pose", "action", "动作", "姿势"], "pose"],
    [["background", "scene", "背景", "场景"], "background"],
    [["effect", "effects", "fx", "特效"], "effect"],
    [["composition", "构图"], "composition"],
    [["material", "texture", "材质", "纹理"], "texture"]
  ];
  groups.forEach(([values, expected]) => values.forEach((value) => assert.equal(normalize(value), expected, value)));
  assert.equal(normalize("HAIRSTYLE"), "hair"); assert.equal(normalize("LIGHT"), "lighting");
});

test("CATEGORY-02 valid unmapped text is preserved instead of becoming other", () => {
  ["head", "fullbody", "accessory", "torso", "自定义分类", "人物精修"].forEach((value) => assert.equal(normalize(value), value));
});

test("CATEGORY-03 missing, empty, non-string and clearly invalid values become other", () => {
  [undefined, null, "", "   ", 123, {}, [], "123", "https://example.test/category", "---"].forEach((value) => assert.equal(normalize(value), "other"));
});

test("CATEGORY-04 normalization preserves subCategory and original category metadata", () => {
  const preset = normalizer.normalizePromptPreset({ id: "one", title: "One", category: "head", subCategory: "face_shape", promptTemplate: "text" });
  assert.equal(preset.category, "head"); assert.equal(preset.subCategory, "face_shape"); assert.equal(preset.metadata.originalCategory, "head");
});

test("CATEGORY-05 stored user presets migrate from other using metadata.originalCategory", () => {
  const state = { version: 2, presets: [
    { id: "recover", title: "Recover", category: "other", promptTemplate: "A", metadata: { originalCategory: "head" } },
    { id: "alias", title: "Alias", category: "other", promptTemplate: "B", metadata: { originalCategory: "服装" } },
    { id: "unknown", title: "Unknown", category: "other", promptTemplate: "C", metadata: {} },
    { id: "factory", title: "Factory", category: "other", factory: true, promptTemplate: "D", metadata: { originalCategory: "head" } }
  ], favorites: [], recent: [], displayNames: {}, lastValues: {}, stack: [], hiddenFactoryPresetIds: [] };
  const storage = new MemoryStorage({ [PROMPT_PRESET_V2_STORAGE_KEY]: JSON.stringify(state) });
  const loaded = new PromptPresetStore({ storage }).loadState();
  assert.equal(loaded.presets[0].category, "head"); assert.equal(loaded.presets[1].category, "clothing");
  assert.equal(loaded.presets[2].category, "other"); assert.equal(loaded.presets[3].category, "other");
  const persisted = JSON.parse(storage.getItem(PROMPT_PRESET_V2_STORAGE_KEY));
  assert.equal(persisted.presets[0].category, "head"); assert.equal(persisted.presets[1].category, "clothing");
});

test("CATEGORY-06 migration does not guess when original category is missing or invalid", () => {
  const restore = require("../client/js/presets/promptPresetStore").restoreStoredPromptPresetCategory;
  assert.equal(restore({ id: "a", title: "A", category: "other", metadata: {} }).category, "other");
  assert.equal(restore({ id: "b", title: "B", category: "other", metadata: { originalCategory: "---" } }).category, "other");
});

test("CATEGORY-07 supplied ZIP reports preserved first-level categories when provided", () => {
  const supplied = process.env.PSAI_PRESET_ZIP_TEST_FILE;
  if (!supplied || !fs.existsSync(supplied)) return;
  const scan = zipApi.scanPromptPresetZip(fs.readFileSync(supplied));
  const categories = new Set(scan.presets.map((preset) => preset.category));
  assert.ok(categories.size > 3); assert.ok(categories.has("hair")); assert.ok(categories.has("lighting"));
});
