"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const logging = require("../client/js/utils/logger");
const { ImportSizingManager } = require("../client/js/photoshop/importSizingManager");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const { UiStateStore } = require("../client/js/storage/uiStateStore");
const hostCompatibility = require("../client/js/compat/hostCompatibility");

const cepRoot = path.resolve(__dirname, "..");

function sizingFixture(width, height) {
  const counters = { canvas: 0, drawImage: 0, toDataURL: 0, writes: 0 };
  function Image() { this.naturalWidth = width; this.naturalHeight = height; }
  Object.defineProperty(Image.prototype, "src", { set() { this.onload(); } });
  const runtimeRoot = { Image, document: { createElement(kind) {
    assert.equal(kind, "canvas"); counters.canvas += 1;
    return { width: 0, height: 0, getContext(type) {
      assert.equal(type, "2d");
      return { clearRect() {}, drawImage() { counters.drawImage += 1; } };
    }, toDataURL(type) { assert.equal(type, "image/png"); counters.toDataURL += 1; return "data:image/png;base64,UE5H"; } };
  } } };
  const files = new Map();
  const cepFs = {
    makedir() { return { err: 0 }; }, stat() { return { err: 0, data: { isDirectory: true } }; },
    writeFile(file, data) { counters.writes += 1; files.set(String(file).replace(/\\/g, "/"), data); return { err: 0 }; },
    deleteFile(file) { files.delete(String(file).replace(/\\/g, "/")); return { err: 0 }; }
  };
  const manager = new ImportSizingManager({ photoshopBridge: { getUserDataRoot() { return "C:/User"; } }, cepFs,
    base64Encoding: "base64", runtimeRoot, now: () => 10 });
  return { manager, counters, files };
}

async function prepareWithDiagnostics(fixture, target) {
  const entries = [], originalInfo = logging.logger.info;
  logging.logger.info = function capture(name, data) { entries.push({ name, data }); };
  try {
    const prepared = await fixture.manager.prepareLocalImage("C:/User/generated-1.png", target);
    return { prepared, entries };
  } finally { logging.logger.info = originalInfo; }
}

test("2048x1152 to 2560x1440 prevents upscale and imports the original PNG", async () => {
  const fixture = sizingFixture(2048, 1152);
  const result = await prepareWithDiagnostics(fixture, { width: 2560, height: 1440 });
  assert.equal(result.prepared.path, "C:/User/generated-1.png");
  assert.equal(result.prepared.transient, false); assert.equal(result.prepared.original, true);
  assert.deepEqual(fixture.counters, { canvas: 0, drawImage: 0, toDataURL: 0, writes: 0 });
  const diagnostic = result.entries.find((entry) => entry.name === "RESULT_MATCH_MAIN_SIZE").data;
  assert.deepEqual({ originalWidth: diagnostic.originalWidth, originalHeight: diagnostic.originalHeight,
    targetWidth: diagnostic.targetWidth, targetHeight: diagnostic.targetHeight, calculatedScale: diagnostic.calculatedScale,
    appliedScale: diagnostic.appliedScale, resizeApplied: diagnostic.resizeApplied, upscalePrevented: diagnostic.upscalePrevented,
    importPathType: diagnostic.importPathType }, { originalWidth: 2048, originalHeight: 1152, targetWidth: 2560, targetHeight: 1440,
    calculatedScale: 1.25, appliedScale: 1, resizeApplied: false, upscalePrevented: true, importPathType: "smart-object-upscale" });
});

test("4096x2160 to 1920x1080 permits one downscale and uses a matched PNG", async () => {
  const fixture = sizingFixture(4096, 2160);
  const result = await prepareWithDiagnostics(fixture, { width: 1920, height: 1080 });
  assert.match(result.prepared.path.replace(/\\/g, "/"), /temp-import\/matched-10-/);
  assert.equal(result.prepared.transient, true); assert.equal(result.prepared.original, false);
  assert.deepEqual(fixture.counters, { canvas: 1, drawImage: 1, toDataURL: 1, writes: 1 });
  assert.equal(result.prepared.fit.appliedScale, 0.46875); assert.equal(result.prepared.fit.resizeApplied, true);
  const diagnostic = result.entries.find((entry) => entry.name === "RESULT_MATCH_MAIN_SIZE").data;
  assert.equal(diagnostic.importPathType, "matched"); assert.equal(diagnostic.upscalePrevented, false);
});

test("equal source and target dimensions bypass Canvas and PNG re-encoding", async () => {
  const fixture = sizingFixture(1920, 1080);
  const result = await prepareWithDiagnostics(fixture, { width: 1920, height: 1080 });
  assert.equal(result.prepared.path, "C:/User/generated-1.png");
  assert.deepEqual(fixture.counters, { canvas: 0, drawImage: 0, toDataURL: 0, writes: 0 });
  assert.equal(result.prepared.fit.calculatedScale, 1); assert.equal(result.prepared.fit.appliedScale, 1);
  assert.equal(result.prepared.fit.resizeApplied, false);
});

test("disabled sizing imports the original generated PNG without invoking the sizing manager", async () => {
  const imported = []; let sizingCalls = 0;
  const importer = new ImageImporter({ photoshopBridge: { isAvailable() { return true; }, async importImage(file) {
    imported.push(file); return { imported: true, layerName: "AI_Generated_001" };
  } }, importSizingManager: { async prepareLocalImage() { sizingCalls += 1; throw new Error("must not run"); } } });
  await importer.importImages([{ importSource: { type: "local-file", path: "C:/User/generated-1.png" } }],
    { matchMainSize: false, mainDimensions: { width: 2560, height: 1440 } });
  assert.deepEqual(imported, ["C:/User/generated-1.png"]); assert.equal(sizingCalls, 0);
});

test("Match Main Image sizing defaults to false and remains explicitly opt-in", () => {
  const values = new Map();
  const storage = { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, value); } };
  const state = new UiStateStore({ storage });
  assert.equal(state.getMatchMainSize(), false);
  state.setMatchMainSize(true); assert.equal(state.getMatchMainSize(), true);
});

for (const major of [23, 24, 25]) test("Photoshop " + major + " fixture retains its CEP11 compatibility profile", () => {
  assert.equal(hostCompatibility.compatibilityProfile({ hostName: "PHSP", hostMajor: major }), "PS" + major + "_CEP11");
});

test("Photoshop duplicate stage performs no second resize", () => {
  const hostSource = fs.readFileSync(path.join(cepRoot, "host", "host.jsx"), "utf8");
  const importBody = hostSource.slice(hostSource.indexOf("api.importImage = function"), hostSource.indexOf("api.importSmartObjectToBounds"));
  assert.match(importBody, /sourceLayer\.duplicate\(targetDocument, ElementPlacement\.PLACEATBEGINNING\)/);
  assert.doesNotMatch(importBody, /resizeImage|resizeCanvas|drawImage|toDataURL|\.crop\(|\.translate\(/);
});
