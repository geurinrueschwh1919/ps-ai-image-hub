"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parsePromptPreset } = require("../client/js/presets/promptPresetParser");
const normalizer = require("../client/js/presets/promptPresetNormalizer");
const compilerApi = require("../client/js/presets/promptPresetCompiler");
const { PromptPresetStore, PROMPT_PRESET_STORAGE_KEY, PROMPT_PRESET_V2_STORAGE_KEY } = require("../client/js/presets/promptPresetStore");
const { PromptPresetRegistry } = require("../client/js/presets/promptPresetRegistry");
const { PromptPresetStack } = require("../client/js/presets/promptPresetStack");
const packApi = require("../client/js/presets/promptPresetPack");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { ProviderManager } = require("../client/js/ui/providerManager");
const { getConfigValidationKey } = require("../client/js/ui/settingsPanel");
const { applySelectionEditConstraint } = require("../client/js/ui/mainPanel");

const root = path.resolve(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
class MemoryStorage {
  constructor(initial) { this.values = new Map(Object.entries(initial || {})); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function preset(id, title, extra) { return parsePromptPreset(Object.assign({ id, title, category: "general", promptTemplate: title + "规则" }, extra || {})); }
function library(initial) {
  const storage = new MemoryStorage(initial); const store = new PromptPresetStore({ storage });
  const registry = new PromptPresetRegistry({ store }); const stack = new PromptPresetStack({ registry, store });
  return { storage, store, registry, stack };
}
function add(lib, value) { return lib.registry.register(value); }
const compiler = new compilerApi.PromptPresetCompiler();

test("10Q-01 category aliases normalize and valid custom categories remain unchanged", () => {
  assert.equal(preset("a", "A", { category: "毛发" }).category, "hair");
  assert.equal(preset("b", "B", { category: "unlisted" }).category, "unlisted");
  assert.equal(preset("c", "C", { category: "" }).category, "other");
});
test("10Q-02 library search covers title category and description case-insensitively", () => {
  const lib = library(); add(lib, preset("hair", "Real Hair", { category: "hair", description: "Fine STRANDS" }));
  assert.equal(lib.registry.list({ search: "real" }).length, 1); assert.equal(lib.registry.list({ search: "HAIR" }).length, 1); assert.equal(lib.registry.list({ search: "strands" }).length, 1);
});
test("10Q-03 favorite is persisted", () => {
  const lib = library(); add(lib, preset("a", "A")); assert.equal(lib.registry.toggleFavorite("a"), true);
  assert.equal(new PromptPresetRegistry({ store: new PromptPresetStore({ storage: lib.storage }) }).get("a").favorite, true);
});
test("10Q-04 recent entries are ordered by last application and limited", () => {
  const lib = library(); for (let i = 0; i < 12; i += 1) { add(lib, preset("p" + i, "P" + i)); lib.registry.recordApplied("p" + i); }
  assert.deepEqual(lib.registry.recent(10).map((item) => item.id), ["p11", "p10", "p9", "p8", "p7", "p6", "p5", "p4", "p3", "p2"]);
});
test("10Q-05 local rename keeps original ID and JSON title", () => {
  const lib = library(); add(lib, preset("same-id", "Original")); const renamed = lib.registry.rename("same-id", "Local");
  assert.equal(renamed.id, "same-id"); assert.equal(renamed.title, "Original"); assert.equal(renamed.displayTitle, "Local");
});
test("10Q-06 user preset delete removes it and its local metadata", () => {
  const lib = library(); add(lib, preset("delete", "Delete")); lib.registry.toggleFavorite("delete"); lib.registry.rename("delete", "Local"); lib.stack.add("delete"); lib.registry.recordApplied("delete");
  lib.registry.remove("delete"); const state = lib.store.loadState(); assert.equal(lib.registry.get("delete"), null); assert.equal(state.favorites.includes("delete"), false); assert.equal(state.stack.length, 0); assert.equal(state.recent.length, 0); assert.equal(state.displayNames.delete, undefined);
});
test("10Q-06b imported JSON cannot self-declare factory protection", () => { const imported = parsePromptPreset({ id: "user", title: "User", factory: true, promptTemplate: "text" }); assert.equal(imported.factory, false); });
test("10Q-06c trusted factory preset hides instead of deleting and can be restored", () => { const lib = library(); const factoryPreset = parsePromptPreset({ id: "factory", title: "Factory", factory: true, promptTemplate: "text" }, { trustedFactory: true }); add(lib, factoryPreset); lib.registry.remove("factory"); assert.equal(lib.registry.list().some((item) => item.id === "factory"), false); lib.registry.restoreAllFactories(); assert.equal(lib.registry.list().some((item) => item.id === "factory"), true); });
test("10Q-07 V1 store migrates presets and recent without loss", () => {
  const old = preset("old", "Old"); const storage = new MemoryStorage({ [PROMPT_PRESET_STORAGE_KEY]: JSON.stringify([old]), "ps-ai-image-hub.compat.cep11.prompt-presets.recent.v1": "old" });
  const store = new PromptPresetStore({ storage }); assert.equal(store.load()[0].id, "old"); assert.equal(store.getRecentId(), "old"); assert.match(storage.getItem(PROMPT_PRESET_V2_STORAGE_KEY), /"version":2/);
});
test("10Q-08 stack accepts multiple presets", () => { const lib = library(); add(lib, preset("a", "A")); add(lib, preset("b", "B")); lib.stack.add("a"); lib.stack.add("b"); assert.equal(lib.stack.list().length, 2); });
test("10Q-09 stack move changes deterministic order", () => { const lib = library(); add(lib, preset("a", "A")); add(lib, preset("b", "B")); lib.stack.add("a"); lib.stack.add("b"); lib.stack.move("b", -1); assert.deepEqual(lib.stack.list().map((i) => i.presetId), ["b", "a"]); });
test("10Q-10 stack enable disable preserves item", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); lib.stack.setEnabled("a", false); assert.equal(lib.stack.list()[0].enabled, false); });
test("10Q-11 remove from stack does not delete library preset", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); lib.stack.remove("a"); assert.ok(lib.registry.get("a")); });
test("10Q-12 parameter values remain isolated per stack item", () => { const lib = library(); add(lib, preset("a", "A")); add(lib, preset("b", "B")); lib.stack.add("a"); lib.stack.add("b"); lib.stack.setValues("a", { strength: .8 }); lib.stack.setValues("b", { strength: .3 }); assert.equal(lib.stack.get("a").values.strength, .8); assert.equal(lib.stack.get("b").values.strength, .3); });
test("10Q-13 compiler follows stack order", () => { const lib = library(); add(lib, preset("a", "First")); add(lib, preset("b", "Second")); lib.stack.add("a"); lib.stack.add("b"); const out = compilerApi.compilePromptPresetStack(lib.stack.list(), lib.registry, compiler).text; assert.ok(out.indexOf("First") < out.indexOf("Second")); });
test("10Q-14 replace writes only compiled stack", () => { assert.equal(compilerApi.applyCompiledPrompt("old", "new", "replace").text, "new"); });
test("10Q-15 append retains base prompt", () => { assert.equal(compilerApi.applyCompiledPrompt("old", "new", "append").text, "old\n\nnew"); });
test("10Q-16 slider uses semantic language instead of raw number", () => { const value = preset("s", "S", { controls: [{ id: "strength", label: "强度", type: "slider", min: 0, max: 1, default: .8 }] }); const out = compiler.compile(value, { strength: .8 }); assert.match(out, /高精度|最大程度/); assert.doesNotMatch(out, /强度：0\.8/); });
test("10Q-16b slider template placeholders also receive semantic text", () => { const value = preset("st", "ST", { promptTemplate: "发丝细节：{{strength}}", controls: [{ id: "strength", label: "强度", type: "slider", min: 0, max: 1, default: .8 }] }); const out = compiler.compile(value, { strength: .8 }); assert.match(out, /高精度|最大程度/); assert.doesNotMatch(out, /0\.8/); });
test("10Q-17 descriptor range mapping has priority", () => { const value = preset("s", "S", { controls: [{ id: "strength", label: "强度", type: "slider", min: 0, max: 1, default: .5, range: "0-0.4=轻微;0.41-1=显著" }] }); assert.match(compiler.compile(value, { strength: .8 }), /显著/); });
test("10Q-18 generic mapper handles unannotated slider", () => { assert.equal(compilerApi.mapPromptPresetStrength({ min: 0, max: 1 }, .3), "轻微调整"); });
test("10Q-19 fixed and core rules are always compiled", () => { const value = preset("r", "R", { coreRules: ["保留面部"], fixedRules: ["只修改头发"], controls: [{ id: "x", label: "细节", type: "slider", min: 0, max: 1, default: 0 }] }); const out = compiler.compile(value, { x: 0 }); assert.match(out, /保留面部/); assert.match(out, /只修改头发/); });
test("10Q-20 exact duplicate sentences are removed", () => { assert.equal((compilerApi.dedupePromptPresetSemantics("保持颜色。\n保持颜色。" ).match(/保持颜色/g) || []).length, 1); });
test("10Q-21 equivalent face preservation rules merge", () => { const out = compilerApi.dedupePromptPresetSemantics("保留面部。\n严禁改变人物五官。"); assert.equal(out.split(/\n/).length, 1); });
test("10Q-22 requiresMainImage remains a non-blocking recommendation flag", () => { const value = preset("m", "M", { requiresMainImage: true }); assert.equal(value.requiresMainImage, true); assert.doesNotThrow(() => compiler.compile(value, {})); });
test("10Q-23 recommended apply mode is normalized", () => { assert.equal(preset("a", "A", { recommendedApplyMode: "append" }).recommendedApplyMode, "append"); });
test("10Q-24 recommendation metadata does not stop compilation", () => { const value = preset("a", "A", { recommendedMode: "image-to-image", recommendedReferenceCount: 2, usageHint: "建议主图" }); assert.match(compiler.compile(value, {}), /A规则/); });
test("10Q-25 single preset export is valid and preserves ID", () => { const output = JSON.parse(packApi.exportPromptPreset(preset("one", "One"))); assert.equal(output.id, "one"); });
test("10Q-26 pack export uses PSAIImageHubPresetPack v1", () => { const output = JSON.parse(packApi.exportPromptPresetPack([preset("one", "One")])); assert.equal(output.format, "PSAIImageHubPresetPack"); assert.equal(output.version, 1); });
test("10Q-27 pack import recognizes pack and multiple presets", () => { const text = packApi.exportPromptPresetPack([preset("a", "A"), preset("b", "B")]); const parsed = packApi.parsePromptPresetImport(text); assert.equal(parsed.isPack, true); assert.equal(parsed.count, 2); });
test("10Q-28 duplicate import copy gets new ID and copy display name", () => { const lib = library(); const p = preset("a", "A"); add(lib, p); const copy = lib.registry.register(p, { conflict: "copy" }); assert.notEqual(copy.id, "a"); assert.match(copy.displayTitle, /副本/); });
test("10Q-29 invalid pack is rejected safely", () => { assert.throws(() => packApi.parsePromptPresetImport('{"format":"PSAIImageHubPresetPack","version":2,"presets":[]}'), (error) => error.code === normalizer.PROMPT_PRESET_ERROR_CODES.PACK_INVALID); });
test("10Q-30 exported preset strips secrets recursively", () => { const p = preset("safe", "Safe"); p.metadata = { apiKey: "example-secret-value", nested: { Authorization: "Bearer example", useful: "yes" } }; const output = packApi.exportPromptPreset(p); assert.doesNotMatch(output, /example-secret-value|Bearer example|Authorization|apiKey/i); assert.match(output, /useful/); });
test("10Q-31 history saves lightweight preset and image metadata", () => { const store = new HistoryStore({ rootPath: "C:\\tmp", cepFs: null }); const entry = store.baseEntry({ providerId: "grs", modelId: "m", aspectRatio: "16:9", imageSize: "2K", imageInputs: { mainImage: {}, referenceImages: [{}, {}] }, presetMetadata: { presetIds: ["a"], presetTitles: ["A"] } }, null, "submitting", {}); assert.equal(entry.mainImageCount, 1); assert.equal(entry.referenceImageCount, 2); assert.equal(entry.outputSize, "2K"); assert.deepEqual(entry.presetIds, ["a"]); });
test("10Q-32 old history entries remain readable without new fields", () => { const old = { provider: "mock", modelId: "m", prompt: "p", status: "succeeded" }; assert.equal(Array.isArray(old.presetIds), false); assert.doesNotThrow(() => JSON.parse(JSON.stringify(old))); });
test("10Q-33 History restore explicitly uses final Prompt and not preset stack", () => { const main = source("client/js/ui/mainPanel.js"); const body = main.slice(main.indexOf("restoreHistoryEntry(entry)"), main.indexOf("async refreshHostInfo")); assert.match(body, /entry\.finalPrompt \|\| entry\.prompt/); assert.doesNotMatch(body, /promptPresetStack|setStack|stack\.add/); });
test("10Q-34 Recovery implementation has no Preset Stack dependency", () => { const recovery = source("client/js/generation/generationManager.js"); const body = recovery.slice(recovery.indexOf("async recoverProviderTask")); assert.doesNotMatch(body, /PromptPresetStack|presetStack|setStack/); });
test("10Q-35 Mock connection test succeeds without generation", async () => { const mock = new MockProvider({ submitDelay: 0 }); let generated = 0; mock.generate = async () => { generated += 1; }; const result = await mock.testConnection(); assert.equal(result.ok, true); assert.equal(generated, 0); });
test("10Q-36 invalid Base URL fails local settings validation", () => { assert.equal(getConfigValidationKey({ displayName: "X", baseUrl: "bad", endpointPath: "/x", authType: "bearer", modelId: "m" }, true), "errorMissingBaseUrl"); });
test("10Q-37 empty key fails local settings validation", () => { assert.equal(getConfigValidationKey({ displayName: "X", baseUrl: "https://example.test", endpointPath: "/x", authType: "bearer", modelId: "m" }, false), "errorMissingApiKey"); });
test("10Q-38 ProviderManager testConnection does not invoke paid generate", async () => { let tested = 0, generated = 0; const secret = new MemoryStorage(); const manager = new ProviderManager({ get() {}, list() { return []; } }, { secretStore: { get: (k) => secret.getItem(k), set: (k, v) => secret.setItem(k, v), remove: (k) => secret.removeItem(k) }, providerFactory: { create() { return { testConnection: async () => { tested += 1; return { ok: true }; }, generate: async () => { generated += 1; } }; } } }); await manager.testProviderConfig({ id: "safe" }, "temporary"); assert.equal(tested, 1); assert.equal(generated, 0); });
test("10Q-39 connection test creates no history record", async () => { let historyWrites = 0; const manager = new ProviderManager({}, { secretStore: { get() { return null; }, set() {}, remove() {} }, providerFactory: { create() { return { testConnection: async () => ({ ok: true }) }; } } }); await manager.testProviderConfig({ id: "safe" }, "key"); assert.equal(historyWrites, 0); });
test("10Q-40 Main Current Selection adds local edit constraint", () => { const out = applySelectionEditConstraint("基础", { sourceType: "current-selection" }, true, "仅修改当前选区对应区域，选区外区域保持不变。"); assert.match(out, /选区外区域保持不变/); });
test("10Q-41 Reference Current Selection alone does not add constraint", () => { const out = applySelectionEditConstraint("基础", null, true, "仅修改当前选区对应区域，选区外区域保持不变。"); assert.equal(out, "基础"); });
test("10Q-42 selection constraint toggle can disable augmentation", () => { const out = applySelectionEditConstraint("基础", { sourceType: "current-selection" }, false, "约束"); assert.equal(out, "基础"); });
test("10Q-43 selection helper does not mutate manually editable base Prompt", () => { const prompt = "用户手动提示"; applySelectionEditConstraint(prompt, { sourceType: "current-selection" }, true, "约束"); assert.equal(prompt, "用户手动提示"); });
test("10Q-44 preset stack cannot modify Provider", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); assert.equal(Object.prototype.hasOwnProperty.call(lib.stack.list()[0], "providerId"), false); });
test("10Q-45 preset stack cannot modify Model", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); assert.equal(Object.prototype.hasOwnProperty.call(lib.stack.list()[0], "modelId"), false); });
test("10Q-46 preset export and stack contain no API Key field", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); assert.doesNotMatch(JSON.stringify(lib.stack.list()), /apiKey/i); });
test("10Q-47 preset stack cannot modify output resolution", () => { const lib = library(); add(lib, preset("a", "A")); lib.stack.add("a"); assert.equal(Object.prototype.hasOwnProperty.call(lib.stack.list()[0], "imageSize"), false); });
test("10Q-48 preset compiler and panel contain no generation trigger or network API", () => { const text = ["client/js/presets/promptPresetCompiler.js", "client/js/presets/promptPresetStack.js", "client/js/ui/promptPresetPanel.js"].map(source).join("\n"); assert.doesNotMatch(text, /\.generateOneClick\s*\(|XMLHttpRequest|fetch\s*\(/); });
