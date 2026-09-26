"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fflate = require("../client/lib/fflate.min.js");
const zipApi = require("../client/js/presets/promptPresetZip");
const { PromptPresetStore } = require("../client/js/presets/promptPresetStore");
const { PromptPresetRegistry } = require("../client/js/presets/promptPresetRegistry");
const { PromptPresetStack } = require("../client/js/presets/promptPresetStack");
const compilerApi = require("../client/js/presets/promptPresetCompiler");
const normalizer = require("../client/js/presets/promptPresetNormalizer");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function json(value) { return fflate.strToU8(typeof value === "string" ? value : JSON.stringify(value)); }
function archive(entries, options) {
  const input = {};
  Object.keys(entries).forEach((name) => { input[name] = json(entries[name]); });
  return fflate.zipSync(input, options || { level: 6 });
}
function library() {
  const storage = new MemoryStorage();
  const store = new PromptPresetStore({ storage });
  const registry = new PromptPresetRegistry({ store });
  const stack = new PromptPresetStack({ registry, store });
  return { storage, store, registry, stack };
}

test("ZIP-01 recursively recognizes JSON and ignores non-JSON and hidden files", () => {
  const scan = zipApi.scanPromptPresetZip(archive({
    "root.json": { id: "root", title: "Root", promptTemplate: "A" },
    "nested/deep/item.JSON": { id: "nested", title: "Nested", promptTemplate: "B" },
    "nested/readme.md": "ignored", "image.png": "ignored", ".hidden.json": { title: "Hidden", promptTemplate: "X" },
    "__MACOSX/meta.json": { title: "Meta", promptTemplate: "X" }
  }));
  assert.equal(scan.jsonFileCount, 2); assert.equal(scan.recognizedCount, 2); assert.equal(scan.importableCount, 2);
  assert.ok(scan.ignoredFileCount >= 3);
});

test("ZIP-02 damaged ZIP is rejected with a stable local error", () => {
  assert.throws(() => zipApi.scanPromptPresetZip(Uint8Array.from([80, 75, 3, 4, 1, 2, 3])),
    (error) => error.code === normalizer.PROMPT_PRESET_ERROR_CODES.ZIP_INVALID);
});

test("ZIP-03 one bad JSON does not prevent another file from importing", () => {
  const scan = zipApi.scanPromptPresetZip(archive({
    "good.json": { id: "good", title: "Good", promptTemplate: "usable" }, "bad.json": "{not-json"
  }));
  assert.equal(scan.jsonFileCount, 2); assert.equal(scan.recognizedCount, 1); assert.equal(scan.importableCount, 1); assert.equal(scan.failureCount, 1);
});

test("ZIP-04 static, parameter, marker, nested content and object arrays reuse the existing parser", () => {
  const marker = "MODULE_START:LIGHT\n@param:strength: 0.8\n@param:strength_label: 光效强度\n@param:strength_range: 0-1\n夜景霓虹\nMODULE_END:LIGHT";
  const scan = zipApi.scanPromptPresetZip(archive({
    "static.json": { id: "static", title: "Static", category: "lighting", promptTemplate: "电影感" },
    "parameter.json": { id: "parameter", title: "Parameter", content: JSON.stringify({ "@param:detail": 0.7, "@param:detail_label": "细节", prompt: "增强细节" }) },
    "marker.json": { id: "marker", title: "Marker", content: marker },
    "nested.json": { id: "nested", title: "Nested", content: JSON.stringify({ instruction: "保持构图" }) },
    "array.json": [{ id: "array-a", title: "Array A", promptTemplate: "A" }, { id: "array-b", title: "Array B", promptTemplate: "B" }]
  }));
  assert.equal(scan.recognizedCount, 6); assert.ok(scan.parameterizedCount >= 2);
  assert.ok(scan.presets.some((preset) => preset.sourceKind === "marker"));
  assert.ok(scan.presets.some((preset) => preset.id === "nested" && preset.sourceKind === "structured"));
});

test("ZIP-05 valid custom categories, subCategory and safe refImages metadata survive", () => {
  const scan = zipApi.scanPromptPresetZip(archive({ "meta.json": {
    id: "meta", title: "Meta", category: "not-in-catalog", subCategory: "face_shape",
    refImages: ["guide.png"], promptTemplate: "保持结构"
  } }));
  assert.equal(scan.unknownCategoryCount, 0); assert.equal(scan.refImagesCount, 1);
  assert.equal(scan.presets[0].category, "not-in-catalog"); assert.equal(scan.presets[0].subCategory, "face_shape");
  assert.deepEqual(scan.presets[0].refImages, ["guide.png"]);
});

test("ZIP-06 incomplete but textual marker data degrades to a static text preset", () => {
  const scan = zipApi.scanPromptPresetZip(archive({ "fallback.json": {
    id: "fallback", title: "Fallback", content: "MODULE_START:BAD\n保留主体与构图"
  } }));
  assert.equal(scan.failureCount, 0); assert.equal(scan.recognizedCount, 1); assert.equal(scan.presets[0].sourceKind, "text");
  assert.match(scan.presets[0].sourceText, /保留主体与构图/);
});

test("ZIP-07 duplicate IDs become copy IDs, duplicate titles are allowed as numbered copies, and identical content is skipped", () => {
  const lib = library();
  lib.registry.register(require("../client/js/presets/promptPresetParser").parsePromptPreset({ id: "same", title: "Title", promptTemplate: "original" }));
  const scan = zipApi.scanPromptPresetZip(archive({
    "id-conflict.json": { id: "same", title: "Different", promptTemplate: "different" },
    "title-conflict.json": { id: "new-id", title: "Title", promptTemplate: "another" },
    "identical.json": { id: "another-id", title: "Another title", promptTemplate: "original" }
  }), { existingPresets: lib.registry.presets });
  assert.equal(scan.duplicateIdCount, 1); assert.equal(scan.duplicateTitleCount, 1); assert.equal(scan.exactDuplicateCount, 1); assert.equal(scan.importableCount, 2);
  const imported = zipApi.importPromptPresetZipScan(scan, lib.registry);
  assert.equal(imported.added.length, 2); assert.equal(imported.skipped, 1);
  assert.ok(imported.added.some((preset) => /-copy/.test(preset.id)));
  assert.ok(imported.added.some((preset) => /副本 1/.test(preset.displayTitle)));
});

test("ZIP-08 imported user presets support persistence, search, category, favorite, recent, stack, Replace, Append and delete", () => {
  const lib = library();
  const scan = zipApi.scanPromptPresetZip(archive({ "preset.json": {
    id: "workflow", title: "Night Hair", category: "hair", description: "searchable", promptTemplate: "发丝细节"
  } }));
  const imported = zipApi.importPromptPresetZipScan(scan, lib.registry).added[0];
  assert.equal(imported.factory, false); assert.equal(lib.registry.list({ search: "searchable", category: "hair" }).length, 1);
  lib.registry.toggleFavorite(imported.id); lib.registry.recordApplied(imported.id); lib.stack.add(imported.id);
  const compiled = compilerApi.compilePromptPresetStack(lib.stack.list(), lib.registry).text;
  assert.equal(compilerApi.applyCompiledPrompt("old", compiled, "replace").text, compiled);
  assert.match(compilerApi.applyCompiledPrompt("old", compiled, "append").text, /^old/);
  const restartedStore = new PromptPresetStore({ storage: lib.storage }); const restarted = new PromptPresetRegistry({ store: restartedStore });
  assert.ok(restarted.get(imported.id)); assert.equal(restarted.get(imported.id).favorite, true); assert.equal(restarted.recent(1)[0].id, imported.id);
  restarted.remove(imported.id); assert.equal(new PromptPresetRegistry({ store: restartedStore }).get(imported.id), null);
});

test("ZIP-09 import sanitization never persists API keys, tokens or Base64 image payloads", () => {
  const scan = zipApi.scanPromptPresetZip(archive({ "safe.json": {
    id: "safe", title: "Safe", promptTemplate: "safe prompt", metadata: { apiKey: "secret-value", useful: "kept" },
    refImages: [{ imageData: "data:image/png;base64,AAAA", name: "guide.png" }]
  } }));
  const serialized = JSON.stringify(scan.presets);
  assert.doesNotMatch(serialized, /secret-value|data:image|apiKey|imageData/i); assert.match(serialized, /guide\.png|useful/);
});

test("ZIP-10 archive, JSON-file and file-count limits are enforced", () => {
  assert.throws(() => zipApi.scanPromptPresetZip(new Uint8Array(zipApi.PROMPT_PRESET_ZIP_MAX_BYTES + 1)),
    (error) => error.code === normalizer.PROMPT_PRESET_ERROR_CODES.FILE_TOO_LARGE);
  const large = "x".repeat(zipApi.PROMPT_PRESET_ZIP_JSON_MAX_BYTES + 1);
  const largeScan = zipApi.scanPromptPresetZip(archive({ "large.json": large }, { level: 9 }));
  assert.equal(largeScan.failureCount, 1); assert.equal(largeScan.importableCount, 0);
  const entries = {}; for (let index = 0; index < 501; index += 1) entries[index + ".json"] = { id: "p" + index, title: "P" + index, promptTemplate: "P" };
  assert.throws(() => zipApi.scanPromptPresetZip(archive(entries)),
    (error) => error.code === normalizer.PROMPT_PRESET_ERROR_CODES.LIMIT_EXCEEDED);
});

test("ZIP-11 UI contains a scan-before-import review and no network or generation trigger", () => {
  const panel = fs.readFileSync(path.join(__dirname, "../client/js/ui/promptPresetPanel.js"), "utf8");
  assert.match(panel, /prompt-preset-import-zip/); assert.match(panel, /prompt-preset-zip-review/);
  assert.match(panel, /promptPresetZipImportAll/); assert.doesNotMatch(panel, /XMLHttpRequest|fetch\s*\(|generateOneClick\s*\(/);
});

test("ZIP-12 the supplied real ZIP can be scanned without hardcoded preset content", () => {
  const supplied = process.env.PSAI_PRESET_ZIP_TEST_FILE;
  if (!supplied || !fs.existsSync(supplied)) return;
  const scan = zipApi.scanPromptPresetZip(fs.readFileSync(supplied));
  assert.ok(scan.jsonFileCount > 1); assert.ok(scan.recognizedCount > 0); assert.equal(scan.failureCount, 0);
});
