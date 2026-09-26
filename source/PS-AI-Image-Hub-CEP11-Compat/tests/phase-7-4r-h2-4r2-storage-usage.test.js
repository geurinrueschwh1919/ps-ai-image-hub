"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { StorageManager } = require("../client/js/storage/storageManager");
const { SettingsPanel, buildStorageUsageMarkup } = require("../client/js/ui/settingsPanel");

const ROOT = "C:/User/PSAIImageHub";

function storageFs(entries, unreadableNames) {
  const files = new Set(Object.keys(entries || {}).map((name) => ROOT + "/" + name));
  const unreadable = new Set(unreadableNames || []);
  function normalized(value) { return String(value).replace(/\\/g, "/").replace(/\/$/, ""); }
  return {
    files,
    readdir(value) {
      const directory = normalized(value);
      if (directory !== ROOT) return { err: 3 };
      return { err: 0, data: [...files].map((name) => name.slice(ROOT.length + 1)) };
    },
    stat(value) {
      const filePath = normalized(value), name = filePath.slice(ROOT.length + 1);
      if (unreadable.has(name)) return { err: 5 };
      return files.has(filePath) ? { err: 0, data: { isDirectory: false } } : { err: 3 };
    },
    deleteFile(value) {
      const filePath = normalized(value);
      if (!files.has(filePath)) return { err: 3 };
      files.delete(filePath); return { err: 0 };
    }
  };
}

function translator(key, values) {
  if (key === "storageFileCount") return String(values.count) + " files";
  return key;
}

test("empty cache reports zero files for every displayed category", () => {
  const report = new StorageManager({ rootPath: ROOT, cepFs: storageFs() }).scan();
  ["temporaryInputs", "recoveryImages", "historyImages", "downloads", "logs", "other"].forEach((name) => {
    assert.equal(report.categories[name].fileCount, 0);
  });
});

test("real directory scan counts files without reading their lengths", () => {
  const report = new StorageManager({ rootPath: ROOT, cepFs: storageFs({
    "generated-one.png": 1024, "generated-two.jpg": 2048, "other.bin": 17
  }) }).scan();
  assert.equal(report.categories.downloads.fileCount, 2);
  assert.equal(report.categories.other.fileCount, 1);
  assert.equal(report.totalFiles, 3);
});

test("Storage markup renders category counts and no byte fields or totals", () => {
  const report = new StorageManager({ rootPath: ROOT, cepFs: storageFs({ "generated-one.png": 1024 }) }).scan();
  const markup = buildStorageUsageMarkup(report, translator);
  assert.match(markup, /storage-usage-count">1 files/);
  assert.match(markup, /storage-usage-count">0 files/);
  assert.doesNotMatch(markup, /storage-usage-size|storage-total|\b(?:B|KB|MB|GB)\b|totalBytes|formatBytes/);
});

test("refresh and cleanup immediately render the new zero file count", async () => {
  const cepFs = storageFs({ "generated-one.png": 4096 });
  const manager = new StorageManager({ rootPath: ROOT, cepFs });
  const fields = { "storage-usage": { innerHTML: "" }, "storage-root-path": { textContent: "" }, "storage-message": { textContent: "" } };
  const panel = Object.create(SettingsPanel.prototype);
  panel.storageManager = manager; panel.t = translator; panel.field = (id) => fields[id];
  panel.refreshStorageUsage();
  assert.match(fields["storage-usage"].innerHTML, /storage-usage-count">1 files/);
  await panel.clearStorage(["downloads"], "confirm");
  assert.match(fields["storage-usage"].innerHTML, /storage-usage-count">0 files/);
  assert.equal(manager.scan().categories.downloads.fileCount, 0);
});

test("an unreadable file is skipped without crashing the remaining count scan", () => {
  const manager = new StorageManager({ rootPath: ROOT, cepFs: storageFs({ "generated-good.png": 1, "generated-locked.png": 1 }, ["generated-locked.png"]) });
  let report;
  assert.doesNotThrow(() => { report = manager.scan(); });
  assert.equal(report.unavailable, false);
  assert.equal(report.unreadableFileCount, 1);
  assert.equal(report.categories.downloads.fileCount, 1);
});

test("all image-cache clearing never deletes sensitive or Provider config", () => {
  const cepFs = storageFs({ "generated-one.png": 1, "sensitive-provider-config.json": 1, "provider-config.json": 1 });
  new StorageManager({ rootPath: ROOT, cepFs }).clearAllImages();
  assert.equal(cepFs.files.has(ROOT + "/generated-one.png"), false);
  assert.equal(cepFs.files.has(ROOT + "/sensitive-provider-config.json"), true);
  assert.equal(cepFs.files.has(ROOT + "/provider-config.json"), true);
});

test("Storage runtime has no byte formatter, totals, or File.length bridge", () => {
  const files = [
    "../client/js/storage/storageManager.js", "../client/js/ui/settingsPanel.js",
    "../client/js/photoshop/bridge.js", "../client/js/photoshop/bridgeSerialization.js", "../host/host.jsx"
  ];
  const source = files.map((name) => fs.readFileSync(path.resolve(__dirname, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /formatBytes|formatStorageBytes|totalBytes|totalCacheBytes|totalImageCacheBytes|getFileSizes|fileReference\.length/);
});
