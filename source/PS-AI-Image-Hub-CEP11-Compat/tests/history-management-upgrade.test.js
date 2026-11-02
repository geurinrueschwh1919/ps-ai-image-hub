"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  HistoryStore, DEFAULT_MAX_HISTORY_COUNT, HISTORY_CAPACITY_OPTIONS, HISTORY_PREFERENCES_KEY
} = require("../client/js/storage/historyStore");
const { filterHistoryEntries, pageHistoryEntries, HISTORY_PAGE_SIZE } = require("../client/js/ui/historyPanel");

const runtime = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(runtime, relative), "utf8");
function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); }, values };
}
function fakeFs(options) {
  const files = new Map(); const settings = options || {};
  return {
    files, makedir() { return { err: 0 }; }, stat() { return { err: 0 }; },
    writeFile(file, data) { if (settings.failWrite && settings.failWrite(file)) return { err: 5 }; files.set(file, data); return { err: 0 }; },
    readFile(file) { return files.has(file) ? { err: 0, data: files.get(file) } : { err: 2 }; },
    deleteFile(file) { if (settings.failDelete && settings.failDelete(file)) return { err: 5 }; files.delete(file); return { err: 0 }; }
  };
}
function createStore(options) {
  const settings = options || {};
  return new HistoryStore(Object.assign({ rootPath: "C:\\HistoryLab", cepFs: settings.cepFs || fakeFs(), storage: settings.storage || memoryStorage(), apiClient: {},
    photoshopBridge: { resolveExtensionAsset() { return "mock.png"; } }, base64Encoding: "base64" }, settings));
}
function input(value) { return { providerId: "mock", modelId: "model", prompt: value, imageInputs: { mainImage: null, referenceImages: [] } }; }
function failure(store, value) { return store.recordFailure(input(value), { code: "X", message: "x" }); }
function pngBase64() { return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString("base64"); }

test("1 default history capacity is 100", () => assert.equal(DEFAULT_MAX_HISTORY_COUNT, 100));
test("2 capacity can be changed to 50 and persists", () => { const storage = memoryStorage(), store = createStore({ storage }); assert.equal(store.setMaxHistoryCount(50), 50); assert.equal(JSON.parse(storage.getItem(HISTORY_PREFERENCES_KEY)).maxHistoryCount, 50); });
test("3 capacity can be changed to 200", () => { const store = createStore(); assert.equal(store.setMaxHistoryCount(200), 200); });
test("4 capacity can be changed to the supported maximum 500", () => { const store = createStore(); assert.deepEqual(HISTORY_CAPACITY_OPTIONS, [50, 100, 200, 500]); assert.equal(store.setMaxHistoryCount(500), 500); });
test("5 exceeding capacity prunes the oldest regular entries", () => { const store = createStore({ maxHistoryCount: 2 }); failure(store, "one"); failure(store, "two"); failure(store, "three"); assert.deepEqual(store.load().map((entry) => entry.prompt), ["three", "two"]); });
test("6 favorite history is excluded from automatic pruning", () => { const store = createStore({ maxHistoryCount: 2 }); const favorite = failure(store, "favorite"); store.setFavorite(favorite.id, true); failure(store, "one"); failure(store, "two"); failure(store, "three"); assert.equal(store.load().some((entry) => entry.id === favorite.id), true); assert.equal(store.load().filter((entry) => !entry.favorite).length, 2); });
test("7 removing favorite protection returns the entry to the pruning queue", () => { const store = createStore({ maxHistoryCount: 2 }); const favorite = failure(store, "old favorite"); store.setFavorite(favorite.id, true); failure(store, "one"); failure(store, "two"); assert.equal(store.setFavorite(favorite.id, false).favorite, false); assert.equal(store.load().some((entry) => entry.id === favorite.id), false); });
test("8 loading 200 metadata entries keeps all records available", () => { const store = createStore({ maxHistoryCount: 500 }); for (let i = 0; i < 200; i += 1) failure(store, "item " + i); assert.equal(store.load().length, 200); });
test("9 loading 500 metadata entries is supported", () => { const store = createStore({ maxHistoryCount: 500 }); for (let i = 0; i < 500; i += 1) failure(store, "item " + i); assert.equal(store.load().length, 500); });
test("10 history pagination starts at 20 and grows without losing metadata", () => { const entries = Array.from({ length: 55 }, (_, id) => ({ id })); assert.equal(HISTORY_PAGE_SIZE, 20); assert.equal(pageHistoryEntries(entries, 20).length, 20); assert.equal(pageHistoryEntries(entries, 40).length, 40); });
test("11 list images are lazy and legacy originals are never assigned as thumbnail src", () => { const panel = read("client/js/ui/historyPanel.js"); assert.match(panel, /image\.loading = "lazy"/); assert.match(panel, /entry\.thumbnail !== entry\.localResultFile/); assert.match(panel, /ensureThumbnail\(entry\.id\)/); });
test("12 new thumbnail and original use separate paths and files", async () => {
  const cepFs = fakeFs(); cepFs.files.set("mock.png", pngBase64());
  const store = createStore({ cepFs, thumbnailCreator: async () => ({ base64: Buffer.from("thumb").toString("base64"), extension: "jpg" }) });
  const entry = await store.recordSuccess(input("image"), { images: [{ importSource: { type: "plugin-asset", relativePath: "mock.png" } }] });
  assert.match(entry.localResultFile, /history\\originals\\.+\.png$/); assert.match(entry.thumbnail, /history\\thumbnails\\.+\.jpg$/); assert.notEqual(entry.thumbnail, entry.localResultFile);
});
test("13 History re-import remains bound to localResultFile original", () => { const source = read("client/js/ui/mainPanel.js"); assert.match(source, /type: "local-file", path: entry\.localResultFile/); assert.doesNotMatch(source, /type: "local-file", path: entry\.thumbnail/); });
test("14 original PNG is stored byte-for-byte and never generated from the thumbnail", async () => {
  const cepFs = fakeFs(); const original = pngBase64(); cepFs.files.set("mock.png", original);
  const store = createStore({ cepFs, thumbnailCreator: async () => ({ base64: "VEhVTUI=", extension: "jpg" }) });
  const entry = await store.recordSuccess(input("quality"), { images: [{ importSource: { type: "plugin-asset", relativePath: "mock.png" } }] });
  assert.equal(cepFs.files.get(entry.localResultFile), original); assert.notEqual(cepFs.files.get(entry.thumbnail), original);
});
test("15 deletion synchronously removes metadata, original and thumbnail", async () => {
  const cepFs = fakeFs(); cepFs.files.set("mock.png", pngBase64());
  const store = createStore({ cepFs, thumbnailCreator: async () => ({ base64: "VEhVTUI=", extension: "jpg" }) });
  const entry = await store.recordSuccess(input("delete"), { images: [{ importSource: { type: "plugin-asset", relativePath: "mock.png" } }] });
  assert.equal(store.delete(entry.id), true); assert.equal(cepFs.files.has(entry.localResultFile), false); assert.equal(cepFs.files.has(entry.thumbnail), false); assert.equal(store.load().some((item) => item.id === entry.id), false);
});
test("16 failed file deletion rolls metadata and deleted files back", async () => {
  const cepFs = fakeFs({ failDelete(file) { return /thumbnails/.test(file); } }); cepFs.files.set("mock.png", pngBase64());
  const store = createStore({ cepFs, thumbnailCreator: async () => ({ base64: "VEhVTUI=", extension: "jpg" }) });
  const entry = await store.recordSuccess(input("rollback"), { images: [{ importSource: { type: "plugin-asset", relativePath: "mock.png" } }] });
  assert.equal(store.delete(entry.id), false); assert.equal(store.load().some((item) => item.id === entry.id), true); assert.equal(cepFs.files.has(entry.localResultFile), true); assert.equal(cepFs.files.has(entry.thumbnail), true);
});
test("17 Auto Sharpen remains wired through the importer", () => { const source = read("client/js/photoshop/imageImporter.js"); assert.match(source, /autoSharpenManager/); assert.match(read("client/js/ui/mainPanel.js"), /manual-sharpen-button/); });
test("18 import sizing and original-file re-import remain intact", () => { const source = read("client/js/ui/mainPanel.js"); assert.match(source, /historyImportOptions/); assert.match(source, /entry\.localResultFile/); assert.match(read("client/js/photoshop/imageImporter.js"), /importSizingManager/); });
test("19 Prompt Preset modules and UI remain mounted", () => { assert.match(read("client/index.html"), /promptPresetStore\.js/); assert.match(read("client/js/ui/mainPanel.js"), /PromptPresetPanel/); });
test("20 History storage remains isolated from the Formal namespace", () => { assert.match(HISTORY_PREFERENCES_KEY, /compat/); assert.doesNotMatch(read("client/js/storage/historyStore.js"), /autosharpen\.lab/); assert.match(read("CSXS/manifest.xml"), /com\.psai\.imagehub\.compat\.cep11\.panel/); });
test("21 search and favorites filter operate over metadata without image reads", () => { const entries = [{ prompt: "Blue sky", favorite: true, status: "succeeded" }, { prompt: "Red car", favorite: false, status: "failed" }]; assert.equal(filterHistoryEntries(entries, "blue", "favorites").length, 1); assert.equal(filterHistoryEntries(entries, "red", "favorites").length, 0); assert.equal(filterHistoryEntries(entries, "", "failed").length, 1); });
test("22 History search keeps a 200 ms debounce", () => assert.match(read("client/js/ui/historyPanel.js"), /setTimeout\([\s\S]*200\)/));
