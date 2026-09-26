"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { UiStateStore, UI_PREFERENCES_STORAGE_KEY } = require("../client/js/storage/uiStateStore");
const { GenerationRecoveryStore } = require("../client/js/storage/generationRecoveryStore");
const { StorageManager, isPathInsideStorageRoot } = require("../client/js/storage/storageManager");
const { ImportSizingManager, calculateFitDimensions } = require("../client/js/photoshop/importSizingManager");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const { GenerationManager } = require("../client/js/generation/generationManager");
const catalog = require("../client/js/providers/grsModelCatalog");

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }, values };
}

function memoryFs() {
  const files = new Map(), dirs = new Set(["C:/User", "C:/User/PSAIImageHub"]);
  const n = (value) => String(value).replace(/\\/g, "/").replace(/\/$/, "");
  return {
    files, dirs,
    makedir(value) { dirs.add(n(value)); return { err: 0 }; },
    writeFile(value, data) { files.set(n(value), String(data)); return { err: 0 }; },
    readFile(value) { const key = n(value); return files.has(key) ? { err: 0, data: files.get(key) } : { err: 1 }; },
    deleteFile(value) { const key = n(value); if (!files.has(key)) return { err: 1 }; files.delete(key); return { err: 0 }; },
    stat(value) { const key = n(value); if (dirs.has(key)) return { err: 0, data: { isDirectory: true, size: 0 } };
      if (files.has(key)) return { err: 0, data: { isDirectory: false, size: files.get(key).length } }; return { err: 1 }; },
    readdir(value) { const base = n(value), prefix = base + "/", names = new Set();
      [...dirs, ...files.keys()].forEach((entry) => { if (entry.indexOf(prefix) !== 0) return; const rest = entry.slice(prefix.length); if (rest) names.add(rest.split("/")[0]); });
      return dirs.has(base) ? { err: 0, data: [...names] } : { err: 1 }; }
  };
}

test("Settings and Generate share one persisted Provider model state", () => {
  const storage = memoryStorage(), saved = [], provider = { config: { id: "grs", modelId: "nano-banana-2" },
    getModels() { return [{ id: "nano-banana-2" }, { id: "gpt-image-2-vip" }]; }, updateConfig(config) { this.config = config; } };
  const manager = { getProviderConfig() { return provider.config; }, setSelectedModel(id, modelId) { provider.updateConfig({ id, modelId }); saved.push(modelId); } };
  const state = new UiStateStore({ providerManager: manager, storage });
  const changes = []; state.subscribe((change) => changes.push(change));
  state.setModel("grs", "gpt-image-2-vip", "settings");
  assert.equal(state.getModel("grs"), "gpt-image-2-vip");
  assert.equal(changes[0].origin, "settings");
  state.setModel("grs", "nano-banana-2", "generate");
  assert.deepEqual(saved, ["gpt-image-2-vip", "nano-banana-2"]);
  assert.equal(changes[1].origin, "generate");
  assert.equal(storage.values.has("ps-ai-image-hub.compat.cep11.model-state"), false);
});

test("panel reopen reads the same Provider model and only UI preferences use their own key", () => {
  const storage = memoryStorage(), manager = { getProviderConfig() { return { modelId: "gpt-image-2-vip" }; } };
  const reopened = new UiStateStore({ providerManager: manager, storage });
  assert.equal(reopened.getModel("grs"), "gpt-image-2-vip");
  assert.equal(reopened.getMatchMainSize(), false);
  reopened.setMatchMainSize(true);
  assert.deepEqual(JSON.parse(storage.getItem(UI_PREFERENCES_STORAGE_KEY)), { matchMainSize: true, selectionPromptConstraint: true });
});

test("VIP 4K to ordinary gpt-image-2 capability falls back to 1K", () => {
  const regular = catalog.getGrsModel("gpt-image-2"), previous = "4K";
  const values = regular.resolutionTiers;
  const selected = values.includes(previous) ? previous : values[0];
  assert.equal(selected, "1K");
});

test("unsupported ratio falls back to the first legal model ratio", () => {
  const model = catalog.getGrsModel("gpt-image-2");
  const previous = "1:3";
  assert.equal(model.supportedAspectRatios.includes(previous) ? previous : model.supportedAspectRatios[0], model.supportedAspectRatios[0]);
});

test("task snapshot stores optimized Main and ordered References then restores them", () => {
  const cepFs = memoryFs(), store = new GenerationRecoveryStore({ rootPath: "C:/User/PSAIImageHub/task-recovery", cepFs, base64Encoding: "base64", now: () => 1000 });
  const image = (id, value, width) => ({ id, apiValue: value, mimeType: "image/jpeg", width, height: 100, sourceLabel: "canvas" });
  const metadata = store.saveSnapshot("task/unsafe", { providerId: "grs", modelId: "gpt-image-2-vip", prompt: "private prompt",
    aspectRatio: "16:9", resolutionTier: "2K", node: "global", baseUrl: "https://example.test", matchMainSize: true,
    mainTargetDimensions: { width: 2560, height: 1440 }, imageInputs: { mainImage: image("main", "AAAA", 2048), referenceImages: [image("r1", "BBBB", 1600), image("r2", "CCCC", 1500)] } });
  assert.equal(metadata.referenceImages.length, 2);
  const restored = store.restoreSnapshot("task/unsafe");
  assert.equal(restored.mainImage.width, 2048);
  assert.deepEqual(restored.referenceImages.map((item) => item.apiValue), ["BBBB", "CCCC"]);
  assert.deepEqual(restored.metadata.mainTargetDimensions, { width: 2560, height: 1440 });
  assert.equal(restored.imagesMissing, false);
});

test("missing recovery image is reported but metadata and Task ID survive", () => {
  const cepFs = memoryFs(), store = new GenerationRecoveryStore({ rootPath: "C:/User/PSAIImageHub/task-recovery", cepFs, base64Encoding: "base64" });
  store.saveSnapshot("task-1", { providerId: "grs", modelId: "m", imageInputs: { mainImage: { apiValue: "AAAA", mimeType: "image/png", width: 10, height: 10 }, referenceImages: [] } });
  const imagePath = [...cepFs.files.keys()].find((item) => item.endsWith("main-preview.png")); cepFs.deleteFile(imagePath);
  const restored = store.restoreSnapshot("task-1");
  assert.equal(restored.metadata.taskId, "task-1"); assert.equal(restored.mainImage, null); assert.equal(restored.imagesMissing, true);
});

test("GenerationManager saves recovery metadata only after provider supplies Task ID", async () => {
  let saved = null;
  const provider = { id: "grs", config: { node: "global" }, getModels() { return [{ id: "m" }]; }, validateConfig() { return { valid: true }; },
    getReadOnlyInfo() { return { baseUrl: "https://safe.example" }; }, async generate(request, options) { options.onTask({ id: "task-acquired" }); return {}; } };
  const manager = new GenerationManager({ providerManager: { requireProvider() { return provider; } }, t: (key) => key,
    recoveryStore: { saveSnapshot(id, input) { saved = { id, input }; } }, responseExtractor: { async extract() { return { images: [{ id: "result" }] }; } } });
  await manager.generateOneClick({ providerId: "grs", modelId: "m", prompt: "p", aspectRatio: "1:1", resolutionTier: "1K",
    imageInputs: { mainImage: { width: 2560, height: 1440 }, referenceImages: [] } }, {});
  assert.equal(saved.id, "task-acquired"); assert.deepEqual(saved.input.mainTargetDimensions, { width: 2560, height: 1440 });
});

test("recovery GET succeeds without any image snapshot store", async () => {
  const provider = { config: { modelId: "m" }, async recoverTask(id) { assert.equal(id, "task-get-only"); return {}; } };
  const manager = new GenerationManager({ providerManager: { requireProvider() { return provider; } }, t: (key) => key,
    responseExtractor: { async extract() { return { images: [{ id: "done" }] }; } } });
  const result = await manager.recoverProviderTask("grs", "task-get-only", { modelId: "m" });
  assert.equal(result.taskId, "task-get-only"); assert.equal(result.images[0].id, "done");
});

test("local cancel exposes only original-task Recovery and no snapshot regenerate action", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /recoverButton\.addEventListener\("click", \(\) => this\.handleRecover\(\)\)/);
  assert.match(source, /recoverProviderTask\(recoveryProviderId/);
  assert.match(source, /originalTask\.providerId/);
  assert.doesNotMatch(source, /regenerate-task|handleSnapshotRegenerate|regenerateButton/);
});

test("same-ratio Fit never enlarges 2048x1152 for a 2560x1440 target", () => {
  const fit = calculateFitDimensions(2048, 1152, 2560, 1440);
  assert.deepEqual({ width: fit.width, height: fit.height, canvasWidth: fit.canvasWidth, canvasHeight: fit.canvasHeight },
    { width: 2048, height: 1152, canvasWidth: 2560, canvasHeight: 1440 });
  assert.equal(fit.calculatedScale, 1.25); assert.equal(fit.appliedScale, 1);
  assert.equal(fit.resizeApplied, false); assert.equal(fit.upscalePrevented, true);
  assert.equal(fit.crop, false); assert.equal(fit.stretch, false); assert.equal(fit.sameRatio, true);
});

test("different-ratio Fit centers complete result with no distortion", () => {
  const fit = calculateFitDimensions(1024, 1024, 2560, 1440);
  assert.deepEqual({ width: fit.width, height: fit.height, x: fit.x, y: fit.y }, { width: 1024, height: 1024, x: 768, y: 208 });
  assert.equal(fit.resizeApplied, false); assert.equal(fit.upscalePrevented, true);
  assert.equal(fit.crop, false); assert.equal(fit.stretch, false);
});

test("ImageImporter uses a temporary matched copy and leaves source path unchanged", async () => {
  const imported = [], removed = [];
  const importer = new ImageImporter({ photoshopBridge: { isAvailable() { return true; }, async importImage(value) { imported.push(value); return { imported: true, layerName: "AI_Generated_001" }; } },
    importSizingManager: { async prepareLocalImage(source, target) { assert.equal(source, "C:/original.png"); assert.deepEqual(target, { width: 2560, height: 1440 }); return { path: "C:/temp/matched.png", transient: true }; }, remove(value) { removed.push(value); } } });
  await importer.importImages([{ importSource: { type: "local-file", path: "C:/original.png" } }], { matchMainSize: true, mainDimensions: { width: 2560, height: 1440 } });
  assert.deepEqual(imported, ["C:/temp/matched.png"]); assert.deepEqual(removed, ["C:/temp/matched.png"]);
});

test("no Main dimensions bypasses sizing and imports original result", async () => {
  const imported = [];
  const importer = new ImageImporter({ photoshopBridge: { isAvailable() { return true; }, async importImage(value) { imported.push(value); return { imported: true, layerName: "x" }; } },
    importSizingManager: { async prepareLocalImage() { throw new Error("must not size"); } } });
  await importer.importImages([{ importSource: { type: "local-file", path: "C:/original.png" } }], { matchMainSize: false });
  assert.deepEqual(imported, ["C:/original.png"]);
});

test("ImportSizingManager writes a temporary PNG only when shrinking and never changes source", async () => {
  const cepFs = memoryFs();
  const manager = new ImportSizingManager({ photoshopBridge: { getUserDataRoot() { return "C:/User"; } }, cepFs, base64Encoding: "base64", now: () => 7,
    codec: { async prepare(source, target, output, write) { assert.equal(source, "C:/history/original.png"); write(output, "PNGDATA"); return calculateFitDimensions(4096, 2160, target.width, target.height); } } });
  const prepared = await manager.prepareLocalImage("C:/history/original.png", { width: 1920, height: 1080 });
  assert.match(prepared.path.replace(/\\/g, "/"), /temp-import\/matched-7-/); assert.equal(cepFs.files.has("C:/history/original.png"), false);
  assert.equal(prepared.fit.canvasWidth, 1920); assert.equal(prepared.fit.resizeApplied, true); assert.equal(prepared.original, false);
});

function seededStorage() {
  const cepFs = memoryFs();
  ["history", "history/images", "task-recovery", "task-recovery/t1", "temp-import"].forEach((name) => cepFs.makedir("C:/User/PSAIImageHub/" + name));
  const add = (name, data) => cepFs.writeFile("C:/User/PSAIImageHub/" + name, data);
  add("reference-canvas-1.png", "111"); add("generated-1.png", "2222"); add("temp-import/matched.png", "55");
  add("task-recovery/t1/main-preview.png", "666666"); add("task-recovery/t1/metadata.json", "{}");
  add("history/images/h.png", "7777777"); add("history/history.json", "[{}]"); add("sensitive-provider-config.json", "SECRET");
  return cepFs;
}

test("StorageManager scans real category file counts", () => {
  const manager = new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs: seededStorage() }), report = manager.scan();
  assert.equal(report.categories.temporaryInputs.fileCount, 2);
  assert.equal(report.categories.recoveryImages.fileCount, 1); assert.equal(report.categories.historyImages.fileCount, 1);
  assert.equal(report.categories.downloads.fileCount, 1); assert.equal(report.categories.sensitiveConfig.fileCount, 1);
});

test("clear temp deletes temp only", () => {
  const cepFs = seededStorage(), manager = new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs });
  manager.clear("temporaryInputs");
  assert.equal([...cepFs.files.keys()].some((name) => /reference-canvas|temp-import/.test(name)), false);
  assert.equal(cepFs.files.has("C:/User/PSAIImageHub/generated-1.png"), true);
});

test("clear recovery images preserves Task ID metadata", () => {
  const cepFs = seededStorage(), taskStore = { cleared: false, clear() { this.cleared = true; } };
  const manager = new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs, taskStore }); manager.clear("recoveryImages");
  assert.equal(cepFs.files.has("C:/User/PSAIImageHub/task-recovery/t1/main-preview.png"), false);
  assert.equal(cepFs.files.has("C:/User/PSAIImageHub/task-recovery/t1/metadata.json"), true); assert.equal(taskStore.cleared, false);
});

test("explicit clear recovery records deletes metadata and Task ID", () => {
  const cepFs = seededStorage(), taskStore = { cleared: false, clear() { this.cleared = true; } };
  new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs, taskStore }).clearRecoveryRecords();
  assert.equal(taskStore.cleared, true); assert.equal(cepFs.files.has("C:/User/PSAIImageHub/task-recovery/t1/metadata.json"), false);
});

test("clear history images preserves metadata and sensitive API Key config", () => {
  const cepFs = seededStorage(), historyStore = { called: false, clearImageReferences() { this.called = true; } };
  new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs, historyStore }).clear("historyImages");
  assert.equal(historyStore.called, true); assert.equal(cepFs.files.has("C:/User/PSAIImageHub/history/history.json"), true);
  assert.equal(cepFs.files.get("C:/User/PSAIImageHub/sensitive-provider-config.json"), "SECRET");
});

test("clear all image cache never deletes Provider config or sensitive API Key config", () => {
  const cepFs = seededStorage(); cepFs.writeFile("C:/User/PSAIImageHub/provider-config.json", "CONFIG");
  new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs }).clearAllImages();
  assert.equal(cepFs.files.get("C:/User/PSAIImageHub/sensitive-provider-config.json"), "SECRET");
  assert.equal(cepFs.files.get("C:/User/PSAIImageHub/provider-config.json"), "CONFIG");
});

test("path traversal and deletion outside PSAIImageHub root are rejected", () => {
  assert.equal(isPathInsideStorageRoot("C:/User/PSAIImageHub/history/a.png", "C:/User/PSAIImageHub"), true);
  assert.equal(isPathInsideStorageRoot("C:/User/PSAIImageHub/../outside.txt", "C:/User/PSAIImageHub"), false);
  const manager = new StorageManager({ rootPath: "C:/User/PSAIImageHub", cepFs: seededStorage() });
  assert.throws(() => manager.deleteFiles(["C:/User/outside.txt"]), /Refusing/);
});

test("Storage UI refreshes usage immediately after every clear action", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  assert.match(source, /storageManager\.clear/); assert.match(source, /storageManager\.clearAllImages/); assert.match(source, /this\.refreshStorageUsage\(\)/);
});

test("History broken thumbnail has a localized fallback", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/historyPanel.js"), "utf8");
  assert.match(source, /addEventListener\("error"/); assert.match(source, /imageCleared/);
});
