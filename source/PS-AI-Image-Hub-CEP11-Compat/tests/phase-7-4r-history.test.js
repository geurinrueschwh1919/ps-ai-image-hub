"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { copyText } = require("../client/js/utils/clipboard");
require("../client/js/ui/mainPanel");
const MainPanel = global.PSAIImageHubCompat.MainPanel;

function pngBase64() { return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString("base64"); }
function fakeFs() {
  const files = new Map();
  return {
    files, makedir() { return { err: 0 }; }, stat() { return { err: 0 }; },
    writeFile(path, data) { files.set(path, data); return { err: 0 }; },
    readFile(path) { return files.has(path) ? { err: 0, data: files.get(path) } : { err: 2 }; },
    deleteFile(path) { files.delete(path); return { err: 0 }; }
  };
}
function store(options) {
  return new HistoryStore(Object.assign({ rootPath: "C:\\UserData", cepFs: fakeFs(), apiClient: {}, photoshopBridge: { resolveExtensionAsset() { return "mock.png"; } }, base64Encoding: "base64", maxHistoryCount: 3 }, options || {}));
}
function input(prompt) { return { providerId: "grs", modelId: "nano-banana-2", prompt, aspectRatio: "1:1", imageSize: "1K", imageInputs: { mainImage: { id: "m", base64: "SECRET-REFERENCE" }, referenceImages: [{ id: "r", base64: "SECRET-REFERENCE" }] } }; }

test("success history persists metadata and a permanent thumbnail without reference Base64", async () => {
  const fs = fakeFs(); fs.files.set("mock.png", pngBase64());
  const history = store({ cepFs: fs });
  const entry = await history.recordSuccess(input("a prompt"), { providerId: "grs", modelId: "nano-banana-2", taskId: "task-1", importState: "imported", images: [{ importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" } }] });
  assert.equal(entry.status, "succeeded"); assert.equal(entry.hasMainImage, true); assert.equal(entry.referenceImageCount, 1); assert.equal(entry.importedToPhotoshop, true);
  assert.match(entry.localResultFile, /history\\images\\history-.*\.png$/);
  const serialized = fs.files.get("C:\\UserData\\PSAIImageHubCompat\\history\\history.json");
  assert.equal(serialized.includes("SECRET-REFERENCE"), false); assert.equal(serialized.includes("apiKey"), false);
});

test("failed history is persisted with sanitized error data", () => {
  const history = store();
  const entry = history.recordFailure(input("failed"), { code: "HTTP_ERROR", message: "Bearer super-secret failed for sk-123456789" });
  assert.equal(entry.status, "failed"); assert.equal(entry.errorCode, "HTTP_ERROR");
  assert.equal(entry.errorMessage.includes("super-secret"), false); assert.equal(entry.errorMessage.includes("sk-123456789"), false);
});

test("history survives a simulated restart", () => {
  const fs = fakeFs(); const first = store({ cepFs: fs }); first.recordFailure(input("one"), { code: "X", message: "x" });
  const restarted = store({ cepFs: fs }); assert.equal(restarted.load()[0].prompt, "one");
});

test("history delete and clear remove metadata and persisted image files", async () => {
  const fs = fakeFs(); fs.files.set("mock.png", pngBase64()); const history = store({ cepFs: fs });
  const a = await history.recordSuccess(input("a"), { images: [{ importSource: { type: "plugin-asset", relativePath: "x" } }] });
  const b = history.recordFailure(input("b"), { code: "X", message: "x" });
  assert.equal(history.delete(a.id), true); assert.equal(history.load().some((entry) => entry.id === a.id), false); assert.equal(fs.files.has(a.localResultFile), false);
  history.clear(); assert.equal(history.load().length, 0); assert.equal(history.load().some((entry) => entry.id === b.id), false);
});

test("history max count prunes the oldest entry", () => {
  const history = store({ maxHistoryCount: 2 });
  history.recordFailure(input("one"), { code: "X", message: "x" }); history.recordFailure(input("two"), { code: "X", message: "x" }); history.recordFailure(input("three"), { code: "X", message: "x" });
  assert.deepEqual(history.load().map((entry) => entry.prompt), ["three", "two"]);
});

test("clipboard native method retains its receiver", async () => {
  const clipboard = { writeText(value) { if (this !== clipboard) throw new TypeError("Illegal invocation"); clipboard.value = value; return Promise.resolve(); } };
  const previous = global.navigator;
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard } });
  try { await copyText("task-1"); assert.equal(clipboard.value, "task-1"); }
  finally { Object.defineProperty(global, "navigator", { configurable: true, value: previous }); }
});

test("history restore returns saved generation parameters to the generation tab", () => {
  const selectedTabs = [];
  const fakePanel = {
    providerManager: { getProvider(id) { return id === "grs" ? {} : null; } },
    providerSelect: { value: "mock" },
    promptInput: { value: "" },
    aspectRatio: { value: "auto", options: [{ value: "auto" }, { value: "16:9" }] },
    imageSize: { value: "1K", options: [{ value: "1K" }, { value: "4K" }] },
    populateModels(modelId) { this.restoredModel = modelId; },
    activateTab(tabId) { selectedTabs.push(tabId); }
  };
  const originalRefresh = global.PSAIImageHubCompat.refreshEnhancedSelect;
  global.PSAIImageHubCompat.refreshEnhancedSelect = function noop() {};
  try {
    MainPanel.prototype.restoreHistoryEntry.call(fakePanel, { provider: "grs", modelId: "nano-banana-2", prompt: "restore me", aspectRatio: "16:9", imageSize: "4K" });
  } finally { global.PSAIImageHubCompat.refreshEnhancedSelect = originalRefresh; }
  assert.equal(fakePanel.providerSelect.value, "grs"); assert.equal(fakePanel.restoredModel, "nano-banana-2");
  assert.equal(fakePanel.promptInput.value, "restore me"); assert.equal(fakePanel.aspectRatio.value, "16:9"); assert.equal(fakePanel.imageSize.value, "4K");
  assert.deepEqual(selectedTabs, ["generate"]);
});

test("history re-import uses the persisted local PNG and marks the entry imported", async () => {
  let importedResult; let markedId; let refreshed = false;
  const fakePanel = {
    generationManager: { async importGeneratedResult(result) { importedResult = result; return { imported: true }; } },
    historyStore: { markImported(id) { markedId = id; } },
    historyPanel: { refresh() { refreshed = true; } },
    handlePipelineStatus() {}, isImporting: true
  };
  const originalFileUrl = global.PSAIImageHubCompat.historyFileUrl;
  global.PSAIImageHubCompat.historyFileUrl = function fileUrl(path) { return "file:///" + path; };
  try {
    await MainPanel.prototype.reimportHistoryEntry.call(fakePanel, { id: "h1", provider: "grs", modelId: "nano-banana-2", prompt: "p", taskId: "t", localResultFile: "C:\\UserData\\h1.png" });
  } finally { global.PSAIImageHubCompat.historyFileUrl = originalFileUrl; }
  assert.equal(importedResult.images[0].importSource.type, "local-file"); assert.equal(importedResult.images[0].importSource.path, "C:\\UserData\\h1.png");
  assert.equal(markedId, "h1"); assert.equal(refreshed, true); assert.equal(fakePanel.isImporting, false);
});
