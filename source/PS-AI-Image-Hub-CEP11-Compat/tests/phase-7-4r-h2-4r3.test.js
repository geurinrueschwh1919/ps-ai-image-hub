"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { StorageManager } = require("../client/js/storage/storageManager");
const { buildStorageUsageMarkup, SettingsPanel } = require("../client/js/ui/settingsPanel");
const { copyText } = require("../client/js/utils/clipboard");
const { calculateImportTransform, ImportSizingManager } = require("../client/js/photoshop/importSizingManager");
const { GenerationRecoveryStore } = require("../client/js/storage/generationRecoveryStore");

const ROOT = "D:/Fixture/UserData/PSAIImageHub";

function treeFs(fileSizes, statFailures) {
  const sizes = new Map(), dirs = new Set([ROOT]), failures = new Set(statFailures || []);
  Object.keys(fileSizes || {}).forEach((relative) => {
    const parts = relative.split("/"), name = parts.pop(); let current = ROOT;
    parts.forEach((part) => { current += "/" + part; dirs.add(current); });
    sizes.set(current + "/" + name, fileSizes[relative]);
  });
  const normalize = (value) => String(value).replace(/\\/g, "/").replace(/\/$/, "");
  return {
    sizes, dirs,
    readdir(value) {
      const base = normalize(value), prefix = base + "/", names = new Set();
      [...dirs, ...sizes.keys()].forEach((entry) => { if (entry.indexOf(prefix) !== 0) return; const rest = entry.slice(prefix.length); if (rest) names.add(rest.split("/")[0]); });
      return dirs.has(base) ? { err: 0, data: [...names] } : { err: 3 };
    },
    stat(value) {
      const item = normalize(value), relative = item.slice(ROOT.length + 1);
      if (failures.has(relative)) return { err: 5 };
      if (dirs.has(item)) return { err: 0, data: { isDirectory() { return true; }, isFile() { return false; } } };
      if (sizes.has(item)) return { err: 0, data: { isDirectory() { return false; }, isFile() { return true; } } };
      return { err: 3 };
    },
    deleteFile(value) { const item = normalize(value); if (!sizes.has(item)) return { err: 3 }; sizes.delete(item); return { err: 0 }; }
  };
}

function translator(key, values) {
  if (key === "storageFileCount") return String(values.count) + " 个文件";
  return key;
}

test("CEP Storage scan counts recovery and history images without byte lookup", () => {
  const cepFs = treeFs({ "task-recovery/t1/main-preview.png": 12582912, "history/images/h1.png": 7340032 });
  const report = new StorageManager({ rootPath: ROOT, cepFs }).scan();
  assert.equal(report.categories.recoveryImages.fileCount, 1);
  assert.equal(report.categories.historyImages.fileCount, 1);
});

test("stat failure is skipped without breaking file counts", () => {
  const cepFs = treeFs({ "generated-good.png": 2048, "generated-locked.png": 4096 }, ["generated-locked.png"]);
  const report = new StorageManager({ rootPath: ROOT, cepFs }).scan();
  assert.equal(report.categories.downloads.fileCount, 1);
  assert.equal(report.unreadableFileCount, 1);
});

test("Storage UI renders only category file counts", () => {
  const cepFs = treeFs({ "generated-one.png": 1024, "history/images/h.png": 2048, "other.bin": 512 });
  const report = new StorageManager({ rootPath: ROOT, cepFs }).scan();
  const markup = buildStorageUsageMarkup(report, translator);
  assert.match(markup, /storage-usage-count">1 个文件/);
  assert.doesNotMatch(markup, /storage-usage-size|storage-total|\b(?:B|KB|MB|GB)\b/);
});

test("native clipboard copies a Unicode Windows path", async () => {
  const previous = globalThis.navigator, clipboard = { value: null, writeText(value) { this.value = value; return Promise.resolve(); } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  try {
    const result = await copyText("D:\\Fixture\\UserData\\PSAIImageHub");
    assert.equal(result.method, "navigator.clipboard"); assert.match(clipboard.value, /Fixture/);
  } finally { Object.defineProperty(globalThis, "navigator", { configurable: true, value: previous }); }
});

test("rejected native clipboard falls back to CEP execCommand", async () => {
  const previousNavigator = globalThis.navigator, previousDocument = globalThis.document; let copied = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText() { return Promise.reject(new Error("denied")); } } } });
  globalThis.document = { body: { appendChild(input) { copied = input.value; }, removeChild() {} },
    createElement() { return { style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {} }; }, execCommand(command) { return command === "copy"; } };
  try { const result = await copyText("C:/缓存/中文用户"); assert.equal(result.method, "execCommand"); assert.equal(copied, "C:/缓存/中文用户"); }
  finally { Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator }); globalThis.document = previousDocument; }
});

test("clipboard total failure is graceful and rejects without startup side effects", async () => {
  const previousNavigator = globalThis.navigator, previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  globalThis.document = { body: { appendChild() {}, removeChild() {} }, createElement() { return { style: {}, select() {} }; }, execCommand() { return false; } };
  try { await assert.rejects(copyText("C:/path"), /Clipboard copy failed/); }
  finally { Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator }); globalThis.document = previousDocument; }
});

test("Copy Path button shows visible success and failure feedback", async () => {
  const hub = globalThis.PSAIImageHubCompat, previousCopy = hub.copyText, previousTimeout = globalThis.setTimeout;
  const fields = { "copy-storage-path": { textContent: "复制路径" }, "storage-root-path": { textContent: "" }, "storage-message": { textContent: "" } };
  const panel = Object.create(SettingsPanel.prototype); panel.storageManager = { rootPath() { return ROOT; } }; panel.field = (id) => fields[id];
  panel.t = (key) => ({ copyPath: "复制路径", copied: "已复制", pathCopied: "路径已复制到剪贴板", copyPathFailed: "复制失败，请手动复制下方路径" }[key] || key);
  globalThis.setTimeout = function noWait() { return 1; };
  try {
    hub.copyText = () => Promise.resolve({ copied: true }); assert.equal(await panel.copyStoragePath(), true);
    assert.equal(fields["copy-storage-path"].textContent, "已复制"); assert.equal(fields["storage-message"].textContent, "路径已复制到剪贴板");
    hub.copyText = () => Promise.reject(new Error("denied")); assert.equal(await panel.copyStoragePath(), false);
    assert.match(fields["storage-message"].textContent, /手动复制/); assert.equal(fields["storage-root-path"].textContent, ROOT);
  } finally { hub.copyText = previousCopy; globalThis.setTimeout = previousTimeout; }
});

test("current canvas target centers a smaller result without enlarging it", () => {
  const fit = calculateImportTransform(2048, 1152, { sourceType: "current-canvas",
    bounds: { left: 0, top: 0, width: 2560, height: 1440 }, documentBounds: { left: 0, top: 0, width: 2560, height: 1440 } });
  assert.deepEqual({ left: fit.finalLeft, top: fit.finalTop, right: fit.finalRight, bottom: fit.finalBottom }, { left: 256, top: 144, right: 2304, bottom: 1296 });
  assert.equal(fit.resizeApplied, false); assert.equal(fit.upscalePrevented, true);
});

test("same-ratio current selection is placed exactly inside saved bounds", () => {
  const fit = calculateImportTransform(1200, 800, { sourceType: "current-selection",
    bounds: { left: 500, top: 300, width: 1200, height: 800 }, documentBounds: { left: 0, top: 0, width: 2560, height: 1440 } });
  assert.deepEqual({ left: fit.finalLeft, top: fit.finalTop, right: fit.finalRight, bottom: fit.finalBottom }, { left: 500, top: 300, right: 1700, bottom: 1100 });
});

test("different-ratio selection uses centered Fit without crop or stretch", () => {
  const fit = calculateImportTransform(1200, 1200, { sourceType: "current-selection",
    bounds: { left: 500, top: 300, width: 1200, height: 800 }, documentBounds: { left: 0, top: 0, width: 2560, height: 1440 } });
  assert.deepEqual({ left: fit.finalLeft, top: fit.finalTop, width: fit.width, height: fit.height }, { left: 700, top: 300, width: 800, height: 800 });
  assert.equal(fit.mode, "fit"); assert.equal(fit.crop, false); assert.equal(fit.stretch, false);
});

test("local image without absolute bounds falls back to document-centered placement", async () => {
  const manager = new ImportSizingManager({ photoshopBridge: { getDocumentMetadata() { return Promise.resolve({ width: 2560, height: 1440 }); } } });
  const target = await manager.resolveTarget({ sourceType: "local-image", width: 1000, height: 800 });
  assert.deepEqual(target.bounds, { left: 780, top: 320, right: 1780, bottom: 1120, width: 1000, height: 800 });
});

function snapshotFs() {
  const files = new Map(), dirs = new Set([ROOT]);
  const normalize = (value) => String(value).replace(/\\/g, "/").replace(/\/$/, "");
  return { files, dirs, makedir(value) { dirs.add(normalize(value)); return { err: 0 }; },
    stat(value) { const item = normalize(value); return dirs.has(item) || files.has(item) ? { err: 0, data: { isDirectory: dirs.has(item) } } : { err: 3 }; },
    readdir(value) { const base = normalize(value), prefix = base + "/", names = new Set(); [...dirs, ...files.keys()].forEach((item) => { if (item.indexOf(prefix) === 0) { const rest = item.slice(prefix.length); if (rest) names.add(rest.split("/")[0]); } }); return dirs.has(base) ? { err: 0, data: [...names] } : { err: 3 }; },
    writeFile(value, data) { files.set(normalize(value), String(data)); return { err: 0 }; }, readFile(value) { const item = normalize(value); return files.has(item) ? { err: 0, data: files.get(item) } : { err: 3 }; }, deleteFile(value) { files.delete(normalize(value)); return { err: 0 }; } };
}

test("saved current-selection bounds survive snapshot restore after selection disappears", () => {
  const cepFs = snapshotFs(), store = new GenerationRecoveryStore({ rootPath: ROOT + "/task-recovery", cepFs, base64Encoding: "base64", now: () => 1000 });
  const bounds = { left: 500, top: 300, right: 1700, bottom: 1100, width: 1200, height: 800 };
  store.saveSnapshot("task-selection", { providerId: "grs", modelId: "m", prompt: "p", matchMainSize: true,
    mainTarget: { sourceType: "current-selection", bounds, documentBounds: { left: 0, top: 0, right: 2560, bottom: 1440, width: 2560, height: 1440 }, width: 1200, height: 800 },
    imageInputs: { mainImage: { sourceType: "current-selection", bounds, width: 1200, height: 800, mimeType: "image/png", apiValue: "AAAA" }, referenceImages: [] } });
  const restored = store.restoreSnapshot("task-selection");
  assert.deepEqual(restored.metadata.mainTarget.bounds, bounds); assert.equal(restored.metadata.mainTarget.sourceType, "current-selection");
  assert.equal(restored.mainImage.sourceType, "recovery-snapshot");
});

test("Storage has no File.length bridge while import protocol never resizes the PSD", () => {
  const host = fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8");
  assert.doesNotMatch(host, /api\.getFileSizes|fileReference\.length/);
  const importBody = host.slice(host.indexOf("api.importImage"), host.indexOf("api.importSmartObjectToBounds"));
  assert.doesNotMatch(importBody, /resizeImage|resizeCanvas|\.crop\(|\.translate\(/);
});
