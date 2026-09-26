"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const compatRoot = path.resolve(__dirname, "../source/PS-AI-Image-Hub-CEP11-Compat");
const formalRoot = path.resolve(__dirname, "../../adobe-photoshop-uxp-ps-ai-image/cep");

function moduleAt(root, relative) { return require(path.join(root, relative)); }

const formalNormalizer = moduleAt(formalRoot, "client/js/presets/promptPresetNormalizer");
const compatNormalizer = moduleAt(compatRoot, "client/js/presets/promptPresetNormalizer");
const formalRegistryApi = moduleAt(formalRoot, "client/js/presets/promptPresetRegistry");
const compatRegistryApi = moduleAt(compatRoot, "client/js/presets/promptPresetRegistry");
const formalZip = moduleAt(formalRoot, "client/js/presets/promptPresetZip");
const compatZip = moduleAt(compatRoot, "client/js/presets/promptPresetZip");
const fflate = moduleAt(formalRoot, "client/lib/fflate.min.js");
const formalSizing = moduleAt(formalRoot, "client/js/photoshop/importSizingManager");
const compatSizing = moduleAt(compatRoot, "client/js/photoshop/importSizingManager");
const formalHistory = moduleAt(formalRoot, "client/js/storage/historyStore");
const compatHistory = moduleAt(compatRoot, "client/js/storage/historyStore");
const formalMain = moduleAt(formalRoot, "client/js/ui/mainPanel");
const compatMain = moduleAt(compatRoot, "client/js/ui/mainPanel");
const formalBridge = moduleAt(formalRoot, "client/js/photoshop/bridgeSerialization");
const compatBridge = moduleAt(compatRoot, "client/js/photoshop/bridgeSerialization");

function stateStore(presets) {
  const state = { favorites: [], recent: [], displayNames: {}, hiddenFactoryPresetIds: [] };
  let values = JSON.parse(JSON.stringify(presets));
  return {
    load() { return JSON.parse(JSON.stringify(values)); },
    save(next) { values = JSON.parse(JSON.stringify(next)); },
    loadState() { return JSON.parse(JSON.stringify(state)); },
    isFavorite(id) { return state.favorites.indexOf(id) !== -1; },
    setFavorite(id, value) { state.favorites = value ? [id].concat(state.favorites.filter((item) => item !== id)) : state.favorites.filter((item) => item !== id); },
    getDisplayName(id) { return state.displayNames[id] || ""; },
    setDisplayName(id, value) { state.displayNames[id] = value; }
  };
}

function normalized(api, value) { return api.normalizePromptPreset(value, { sourceKind: "structured" }); }

test("Formal / Compat preset normalization preserves the same business schema", () => {
  const fixture = { id: "parity-one", title: "Parity", category: "portrait", subCategory: "studio",
    refImages: ["ref.png"], content: "@param:strength|range|0|100|50|1\nPortrait {strength}" };
  assert.deepEqual(normalized(compatNormalizer, fixture), normalized(formalNormalizer, fixture));
  assert.equal(compatNormalizer.normalizePromptPresetCategory("unlisted-user-category"), "unlisted-user-category");
  assert.equal(compatNormalizer.normalizePromptPresetCategory(""), "other");
});

test("Formal / Compat Favorites and search filtering return the same preset IDs", () => {
  const fixtures = [
    normalized(formalNormalizer, { id: "built-in", title: "Studio Portrait", category: "portrait", content: "soft light" }),
    normalized(formalNormalizer, { id: "imported", title: "Imported FX", category: "effect", content: "neon glow" })
  ];
  const formalStore = stateStore(fixtures), compatStore = stateStore(fixtures);
  const formal = new formalRegistryApi.PromptPresetRegistry({ store: formalStore });
  const compat = new compatRegistryApi.PromptPresetRegistry({ store: compatStore });
  formal.toggleFavorite("imported"); compat.toggleFavorite("imported");
  assert.deepEqual(compat.list({ category: "**favorites**" }).map((item) => item.id), formal.list({ category: "**favorites**" }).map((item) => item.id));
  assert.deepEqual(compat.list({ category: "**favorites**", search: "neon" }).map((item) => item.id), formal.list({ category: "**favorites**", search: "neon" }).map((item) => item.id));
});

test("Formal / Compat ZIP import scans nested JSON with matching results", () => {
  const encoder = new TextEncoder();
  const archive = fflate.zipSync({
    "nested/static.json": encoder.encode(JSON.stringify({ id: "zip-static", title: "ZIP Static", category: "portrait", content: "portrait prompt" })),
    "nested/parameter.json": encoder.encode(JSON.stringify({ id: "zip-param", title: "ZIP Param", category: "lighting", content: "@param:power|range|0|10|5|1\nLight {power}" })),
    "ignored/readme.txt": encoder.encode("ignored")
  });
  const formal = formalZip.scanPromptPresetZip(archive, { existingPresets: [] });
  const compat = compatZip.scanPromptPresetZip(archive, { existingPresets: [] });
  const fields = ["jsonFileCount", "recognizedCount", "importableCount", "failureCount", "parameterizedCount", "ignoredFileCount"];
  assert.deepEqual(Object.fromEntries(fields.map((key) => [key, compat[key]])), Object.fromEntries(fields.map((key) => [key, formal[key]])));
  assert.deepEqual(compat.presets.map((item) => [item.id, item.category]), formal.presets.map((item) => [item.id, item.category]));
});

test("Formal / Compat import sizing decisions are identical", () => {
  const cases = [[2048, 1152, 2560, 1440], [4096, 2160, 1920, 1080], [2048, 2048, 2048, 2048]];
  cases.forEach((values) => {
    assert.deepEqual(compatSizing.calculateFitDimensions(...values), formalSizing.calculateFitDimensions(...values));
  });
});

test("Formal / Compat History import context and re-import options remain schema-compatible", () => {
  const context = { importSizingEnabled: true, targetBounds: { left: 10, top: 20, right: 1010, bottom: 820, width: 1000, height: 800 },
    targetWidth: 1000, targetHeight: 800, documentWidth: 2000, documentHeight: 1200, mainSourceType: "current-selection",
    importPathType: "smart-object-upscale", usedSmartObjectUpscale: true };
  assert.deepEqual(compatHistory.sanitizeHistoryImportContext(context), formalHistory.sanitizeHistoryImportContext(context));
  assert.deepEqual(compatMain.buildHistoryImportOptions(context, true), formalMain.buildHistoryImportOptions(context, true));
  assert.equal(compatMain.importDocumentsMatch({ width: 2000, height: 1200 }, context), true);
});

test("Compat bridge keeps the Formal business methods plus its capability method", () => {
  Object.keys(formalBridge.ALLOWED_HOST_METHODS).forEach((name) => {
    assert.equal(compatBridge.ALLOWED_HOST_METHODS[name], formalBridge.ALLOWED_HOST_METHODS[name], name);
  });
  assert.equal(compatBridge.ALLOWED_HOST_METHODS.importSmartObjectToBounds, 5);
  assert.equal(compatBridge.ALLOWED_HOST_METHODS.getHostCapabilities, 0);
});

test("Compat client, allowlist and ES3 Host expose one consistent method surface", () => {
  const clientRoot = path.join(compatRoot, "client/js");
  const clientText = fs.readdirSync(clientRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.js$/i.test(entry.name))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath || entry.path, entry.name), "utf8")).join("\n");
  const hostText = fs.readFileSync(path.join(compatRoot, "host/host.jsx"), "utf8");
  const invoked = new Set(Array.from(clientText.matchAll(/\.invoke\(\s*["']([A-Za-z0-9_]+)["']/g), (match) => match[1]));
  const hostMethods = new Set(Array.from(hostText.matchAll(/api\.([A-Za-z0-9_]+)\s*=\s*function/g), (match) => match[1]));
  invoked.forEach((name) => {
    assert.equal(Object.prototype.hasOwnProperty.call(compatBridge.ALLOWED_HOST_METHODS, name), true, "allowlist: " + name);
    assert.equal(hostMethods.has(name), true, "host: " + name);
  });
  Object.keys(compatBridge.ALLOWED_HOST_METHODS).forEach((name) => assert.equal(hostMethods.has(name), true, "host allowlisted: " + name));
});

test("Smart Object upscale, warning and History diagnostics exist in both runtimes", () => {
  const files = ["client/js/photoshop/imageImporter.js", "client/js/ui/mainPanel.js", "client/js/storage/historyStore.js", "host/host.jsx"];
  files.forEach((relative) => {
    const formal = fs.readFileSync(path.join(formalRoot, relative), "utf8");
    const compat = fs.readFileSync(path.join(compatRoot, relative), "utf8");
    ["importSmartObjectToBounds", "targetBounds", "importContext"].forEach((marker) => {
      if (formal.indexOf(marker) !== -1) assert.notEqual(compat.indexOf(marker), -1, relative + ": " + marker);
    });
  });
  const compatPanel = fs.readFileSync(path.join(compatRoot, "client/js/ui/mainPanel.js"), "utf8");
  assert.match(compatPanel, /import-quality-warning/);
  assert.match(compatPanel, /historyReimportUsedSavedContext/);
});
