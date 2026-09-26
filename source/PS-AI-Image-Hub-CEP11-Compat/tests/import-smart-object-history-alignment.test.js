"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");
const { ImportSizingManager } = require("../client/js/photoshop/importSizingManager");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { ALLOWED_HOST_METHODS, buildHostCall } = require("../client/js/photoshop/bridgeSerialization");
const { HistoryStore, sanitizeHistoryImportContext } = require("../client/js/storage/historyStore");
const mainPanelApi = require("../client/js/ui/mainPanel");

function runtime(width, height, counters) {
  class FakeImage {
    constructor() { this.naturalWidth = width; this.naturalHeight = height; }
    set src(value) { counters.source = value; this.onload(); }
  }
  return { Image: FakeImage, document: { createElement() {
    counters.canvas += 1;
    return { width: 0, height: 0, getContext() { return { clearRect() {}, drawImage() { counters.draw += 1; } }; },
      toDataURL() { counters.encode += 1; return "data:image/png;base64,UE5H"; } };
  } } };
}

function fileSystem() {
  const writes = [];
  return { writes, makedir() { return { err: 0 }; }, stat() { return { err: 0, data: { isDirectory: true } }; },
    writeFile(filePath, data) { writes.push({ filePath, data }); return { err: 0 }; }, deleteFile() { return { err: 0 }; } };
}

function sizing(width, height, counters) {
  const cepFs = fileSystem();
  return { cepFs, manager: new ImportSizingManager({ photoshopBridge: { getUserDataRoot() { return "C:/User"; } },
    cepFs, base64Encoding: "base64", runtimeRoot: runtime(width, height, counters), now: () => 5 }) };
}

const largeTarget = { sourceType: "current-selection",
  bounds: { left: 100, top: 50, right: 2660, bottom: 1490, width: 2560, height: 1440 },
  documentBounds: { left: 0, top: 0, right: 3000, bottom: 2000, width: 3000, height: 2000 },
  width: 2560, height: 1440 };

test("small result uses original PNG plus Photoshop Smart Object upscale and saved alignment", async () => {
  const counters = { canvas: 0, draw: 0, encode: 0 }, setup = sizing(2048, 1152, counters);
  let smartCall = null, ordinaryCalls = 0;
  const importer = new ImageImporter({ importSizingManager: setup.manager, photoshopBridge: {
    isAvailable() { return true; }, async importImage() { ordinaryCalls += 1; throw new Error("ordinary import must not run"); },
    async importSmartObjectToBounds(filePath, bounds) { smartCall = { filePath, bounds }; return { imported: true,
      layerName: "AI_Generated_001", documentName: "target.psd", documentWidth: 3000, documentHeight: 2000,
      sourceWidth: 2048, sourceHeight: 1152, appliedScale: 1.25, usedSmartObjectUpscale: true,
      finalBounds: { left: 100, top: 50, right: 2660, bottom: 1490, width: 2560, height: 1440 } }; }
  } });
  const result = await importer.importImages([{ importSource: { type: "local-file", path: "C:/cache/generated.png" } }],
    { matchMainSize: true, mainTarget: largeTarget });
  assert.equal(ordinaryCalls, 0); assert.equal(smartCall.filePath, "C:/cache/generated.png");
  assert.deepEqual(smartCall.bounds, largeTarget.bounds);
  assert.equal(counters.canvas, 0); assert.equal(counters.draw, 0); assert.equal(counters.encode, 0); assert.equal(setup.cepFs.writes.length, 0);
  assert.equal(result.importContext.importPathType, "smart-object-upscale");
  assert.equal(result.importContext.usedSmartObjectUpscale, true); assert.equal(result.importContext.upscalePrevented, true);
  assert.equal(result.importContext.appliedScale, 1.25);
  assert.deepEqual(result.importContext.targetBounds, largeTarget.bounds);
});

test("larger result is shrunk through one matched PNG and keeps centered Fit alignment", async () => {
  const counters = { canvas: 0, draw: 0, encode: 0 }, setup = sizing(4096, 2160, counters);
  let imported = "", smartCalls = 0;
  const target = { sourceType: "current-canvas", bounds: { left: 0, top: 0, width: 1920, height: 1080 },
    documentBounds: { left: 0, top: 0, width: 1920, height: 1080 }, width: 1920, height: 1080 };
  const importer = new ImageImporter({ importSizingManager: setup.manager, photoshopBridge: { isAvailable() { return true; },
    async importImage(filePath) { imported = filePath; return { imported: true, layerName: "AI_Generated_002", documentWidth: 1920, documentHeight: 1080 }; },
    async importSmartObjectToBounds() { smartCalls += 1; } } });
  const result = await importer.importImages([{ importSource: { type: "local-file", path: "C:/cache/large.png" } }],
    { matchMainSize: true, mainTarget: target });
  assert.match(imported.replace(/\\/g, "/"), /temp-import\/matched-5-/); assert.equal(smartCalls, 0);
  assert.equal(counters.canvas, 1); assert.equal(counters.draw, 1); assert.equal(counters.encode, 1); assert.equal(setup.cepFs.writes.length, 1);
  assert.equal(result.importContext.importPathType, "matched"); assert.equal(result.importContext.resizeApplied, true);
});

test("equal-size result remains original and uses Photoshop placement only when alignment is needed", async () => {
  const counters = { canvas: 0, draw: 0, encode: 0 }, setup = sizing(1200, 800, counters);
  const target = { sourceType: "current-selection", bounds: { left: 500, top: 300, width: 1200, height: 800 },
    documentBounds: { left: 0, top: 0, width: 2560, height: 1440 }, width: 1200, height: 800 };
  let smartPath = "";
  const importer = new ImageImporter({ importSizingManager: setup.manager, photoshopBridge: { isAvailable() { return true; },
    async importImage() { throw new Error("offset alignment must use host placement"); },
    async importSmartObjectToBounds(filePath, bounds) { smartPath = filePath; return { imported: true, layerName: "AI_Generated_003",
      documentWidth: 2560, documentHeight: 1440, usedSmartObjectUpscale: false, finalBounds: bounds }; } } });
  const result = await importer.importImages([{ importSource: { type: "local-file", path: "C:/cache/equal.png" } }],
    { matchMainSize: true, mainTarget: target });
  assert.equal(smartPath, "C:/cache/equal.png"); assert.equal(setup.cepFs.writes.length, 0); assert.equal(counters.canvas, 0);
  assert.equal(result.importContext.importPathType, "original"); assert.equal(result.importContext.usedSmartObjectUpscale, false);
  assert.deepEqual(result.importContext.finalBounds, { left: 500, top: 300, right: 1700, bottom: 1100, width: 1200, height: 800 });
});

test("Smart Object host failure is explicit and never falls back to ordinary or Canvas upscale", async () => {
  const counters = { canvas: 0, draw: 0, encode: 0 }, setup = sizing(2048, 1152, counters);
  let ordinaryCalls = 0;
  const importer = new ImageImporter({ importSizingManager: setup.manager, photoshopBridge: { isAvailable() { return true; },
    async importImage() { ordinaryCalls += 1; }, async importSmartObjectToBounds() {
      throw new AppError(ErrorCodes.SMART_OBJECT_IMPORT_FAILED, "conversion failed");
    } } });
  await assert.rejects(importer.importImages([{ importSource: { type: "local-file", path: "C:/cache/generated.png" } }],
    { matchMainSize: true, mainTarget: largeTarget }), (error) => error.code === "SMART_OBJECT_IMPORT_FAILED");
  assert.equal(ordinaryCalls, 0); assert.equal(counters.canvas, 0); assert.equal(setup.cepFs.writes.length, 0);
});

test("new fixed host method is allowlisted while unknown methods remain blocked", () => {
  assert.equal(ALLOWED_HOST_METHODS.importSmartObjectToBounds, 5);
  assert.equal(buildHostCall("importSmartObjectToBounds", ["C:/a.png", 1, 2, 3, 4]),
    'PSAIImageHubCompatHost.importSmartObjectToBounds("C:/a.png","1","2","3","4")');
  assert.throws(() => buildHostCall("executeAnything", []), /not allowed/);
  const host = fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8");
  const body = host.slice(host.indexOf("api.importSmartObjectToBounds"), host.indexOf("api._nextGeneratedLayerNameFromNames"));
  assert.match(body, /newPlacedLayer/); assert.match(body, /importedLayer\.resize/); assert.match(body, /importedLayer\.translate/);
  assert.doesNotMatch(body, /canvas|toDataURL|drawImage/i);
});

test("Photoshop Host Smart Object method scales and centers one layer into exact target bounds", () => {
  const unit = (value) => ({ as() { return value; } });
  const targetDocument = { name: "target.psd", width: unit(3000), height: unit(2000), layers: [{ name: "Background", typename: "ArtLayer" }], activeLayer: null };
  const sourceLayer = { name: "source", typename: "ArtLayer", duplicate(target) {
    const copy = { name: this.name, typename: "ArtLayer", kind: "SMARTOBJECT", _bounds: [0, 0, 2048, 1152],
      get bounds() { return this._bounds.map(unit); },
      resize(horizontal) { const scale = horizontal / 100, cx = (this._bounds[0] + this._bounds[2]) / 2, cy = (this._bounds[1] + this._bounds[3]) / 2;
        const width = (this._bounds[2] - this._bounds[0]) * scale, height = (this._bounds[3] - this._bounds[1]) * scale;
        this._bounds = [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2]; },
      translate(dx, dy) { this._bounds = [this._bounds[0] + dx, this._bounds[1] + dy, this._bounds[2] + dx, this._bounds[3] + dy]; },
      remove() { const index = target.layers.indexOf(this); if (index >= 0) target.layers.splice(index, 1); } };
    target.layers.unshift(copy); target.activeLayer = copy; return copy;
  } };
  const sourceDocument = { width: unit(2048), height: unit(1152), layers: [sourceLayer], activeLayer: sourceLayer, close() {} };
  const pngHeader = String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10);
  function ValidFile(filePath) { return { exists: true, name: "generated.png", fsName: filePath, encoding: "UTF-8",
    open() { return true; }, read() { return pngHeader; }, close() {} }; }
  const app = { documents: [targetDocument], activeDocument: targetDocument, open() { this.activeDocument = sourceDocument; return sourceDocument; } };
  const context = { app, File: ValidFile, ElementPlacement: { PLACEATBEGINNING: "begin" }, SaveOptions: { DONOTSAVECHANGES: "no" },
    DialogModes: { NO: "no" }, AnchorPosition: { MIDDLECENTER: "center" }, UnitValue(value) { return Number(value); },
    stringIDToTypeID(value) { return value; }, executeAction(action) { assert.equal(action, "newPlacedLayer"); }, isFinite, parseInt, Error };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8"), context);
  const response = JSON.parse(context.PSAIImageHubCompatHost.importSmartObjectToBounds("C:/cache/generated.png", 100, 50, 2560, 1440));
  assert.equal(response.ok, true); assert.equal(response.data.usedSmartObjectUpscale, true); assert.equal(response.data.appliedScale, 1.25);
  assert.deepEqual(response.data.finalBounds, { left: 100, top: 50, right: 2660, bottom: 1490, width: 2560, height: 1440 });
  assert.equal(targetDocument.layers.length, 2); assert.equal(targetDocument.layers[0].name, "AI_Generated_001");
});

test("History import context sanitizer preserves alignment fields and drops unknown sensitive data", () => {
  const context = sanitizeHistoryImportContext({ importSizingEnabled: true, importPathType: "smart-object-upscale",
    targetBounds: { left: 100, top: 50, width: 2560, height: 1440 }, targetWidth: 2560, targetHeight: 1440,
    originalWidth: 2048, originalHeight: 1152, calculatedScale: 1.25, appliedScale: 1,
    resizeApplied: false, upscalePrevented: true, alignmentAnchor: "center", fitMode: "fit",
    documentWidth: 3000, documentHeight: 2000, documentName: "target.psd", mainSourceType: "current-selection",
    usedSmartObjectUpscale: true, apiKey: "must-not-survive" });
  assert.equal(context.importPathType, "smart-object-upscale"); assert.equal(context.usedSmartObjectUpscale, true);
  assert.deepEqual(context.targetBounds, largeTarget.bounds); assert.equal(Object.prototype.hasOwnProperty.call(context, "apiKey"), false);
});

test("successful import writes its context to the owned History record", async () => {
  let saved = null;
  const expected = { importPathType: "original", documentWidth: 100, documentHeight: 100 };
  const manager = new GenerationManager({ providerManager: {}, t: (key) => key,
    imageImporter: { supportsProgressCallbacks: true, async importImages() { return { imported: true, importContext: expected }; } },
    historyStore: { markImported(id, context) { saved = { id, context }; } } });
  const result = { providerId: "mock", modelId: "m", historyId: "history-1", images: [{}], importState: "notImported", importOptions: {} };
  await manager.importGeneratedResult(result, {});
  assert.deepEqual(saved, { id: "history-1", context: expected });
});

test("History re-import never overwrites the original saved alignment context", () => {
  const original = sanitizeHistoryImportContext({ importSizingEnabled: true, targetBounds: { left: 10, top: 20, width: 100, height: 80 },
    targetWidth: 100, targetHeight: 80, documentWidth: 1000, documentHeight: 800, importPathType: "original" });
  const store = new HistoryStore({ rootPath: "C:/unit", cepFs: null });
  store.entries = [{ id: "h1", importContext: original, importedToPhotoshop: true, importStatus: "imported" }];
  store.write = function noop() {};
  store.markImported("h1", Object.assign({}, original, { documentWidth: 2000, historyReimportUsedSavedContext: true }));
  assert.equal(store.entries[0].importContext.documentWidth, 1000);
  assert.deepEqual(store.entries[0].importContext.targetBounds, original.targetBounds);
});

test("History re-import reuses saved bounds and strategy when document dimensions match", async () => {
  const context = sanitizeHistoryImportContext({ importSizingEnabled: true, importPathType: "smart-object-upscale",
    targetBounds: { left: 100, top: 50, width: 2560, height: 1440 }, targetWidth: 2560, targetHeight: 1440,
    originalWidth: 2048, originalHeight: 1152, calculatedScale: 1.25, appliedScale: 1,
    documentWidth: 3000, documentHeight: 2000, mainSourceType: "current-selection", usedSmartObjectUpscale: true });
  let captured = null, marked = null, confirmCalls = 0;
  globalThis.PSAIImageHubCompat = globalThis.PSAIImageHubCompat || {}; globalThis.PSAIImageHubCompat.historyFileUrl = (value) => value;
  const previousConfirm = globalThis.confirm; globalThis.confirm = () => { confirmCalls += 1; return true; };
  const panel = { photoshopBridge: { async getDocumentMetadata() { return { width: 3000, height: 2000 }; } },
    generationManager: { async importGeneratedResult(result) { captured = result; result.importResult = { importContext: context }; } },
    historyStore: { markImported(id) { marked = id; } }, historyPanel: { refresh() {} }, isImporting: false,
    handlePipelineStatus() {}, t(key) { return key; } };
  try { await mainPanelApi.MainPanel.prototype.reimportHistoryEntry.call(panel,
    { id: "h1", provider: "grs", modelId: "m", localResultFile: "C:/history/h1.png", importContext: context }); }
  finally { globalThis.confirm = previousConfirm; }
  assert.equal(confirmCalls, 0); assert.equal(marked, "h1");
  assert.equal(captured.importOptions.historyReimportUsedSavedContext, true);
  assert.equal(captured.importOptions.currentDocumentMatchesSavedImportContext, true);
  assert.deepEqual(captured.importOptions.mainTarget.bounds, context.targetBounds);
});

test("History re-import warns and cancels on document-size mismatch without importing", async () => {
  const context = sanitizeHistoryImportContext({ importSizingEnabled: true,
    targetBounds: { left: 0, top: 0, width: 100, height: 100 }, targetWidth: 100, targetHeight: 100,
    documentWidth: 1000, documentHeight: 1000 });
  let imports = 0, prompt = "";
  const previousConfirm = globalThis.confirm; globalThis.confirm = (message) => { prompt = message; return false; };
  const panel = { photoshopBridge: { async getDocumentMetadata() { return { width: 2000, height: 1000 }; } },
    generationManager: { async importGeneratedResult() { imports += 1; } }, historyStore: {}, historyPanel: { refresh() {} },
    t(key, values) { return key === "historyReimportDocumentMismatch" ? "mismatch " + values.current + " / " + values.saved : key; } };
  try { await mainPanelApi.MainPanel.prototype.reimportHistoryEntry.call(panel,
    { id: "h2", provider: "mock", modelId: "m", localResultFile: "C:/history/h2.png", importContext: context }); }
  finally { globalThis.confirm = previousConfirm; }
  assert.equal(imports, 0); assert.match(prompt, /2000 × 1000/); assert.match(prompt, /1000 × 1000/);
});

test("expected output warning supports x/* sizes and all three upscale levels", () => {
  const model = { resolutionTiersByAspectRatio: { "16:9": { "1K": "1280x720", "2K": "1920*1080" } } };
  assert.deepEqual(mainPanelApi.resolveExpectedOutputDimensions(model, "16:9", "1K"), { width: 1280, height: 720 });
  assert.deepEqual(mainPanelApi.resolveExpectedOutputDimensions(model, "16:9", "2K"), { width: 1920, height: 1080 });
  assert.equal(mainPanelApi.calculateImportUpscaleRisk({ width: 1000, height: 1000 }, { width: 1200, height: 1200 }).level, "mild");
  assert.equal(mainPanelApi.calculateImportUpscaleRisk({ width: 1000, height: 1000 }, { width: 1500, height: 1500 }).level, "medium");
  assert.equal(mainPanelApi.calculateImportUpscaleRisk({ width: 1000, height: 1000 }, { width: 2100, height: 2100 }).level, "high");
  assert.equal(mainPanelApi.calculateImportUpscaleRisk({ width: 2000, height: 2000 }, { width: 1000, height: 1000 }), null);
});

test("Generate UI warning is non-blocking, severity-aware, and hidden when matching is off", () => {
  const model = { supportedAspectRatios: ["16:9"], resolutionTiersByAspectRatio: { "16:9": { "1K": "1280x720" } } };
  const warning = { hidden: true, className: "", textContent: "" };
  const panel = { importQualityWarning: warning, providerSelect: { value: "grs" }, modelSelector: { getValue() { return "m"; } },
    providerManager: { getProvider() { return { getModel() { return model; } }; } }, aspectRatio: { value: "16:9" },
    imageSize: { value: "1K" }, mainImage: { width: 2560, height: 1440 }, references: [], documentMetadata: null,
    uiStateStore: { getMatchMainSize() { return true; } }, warningAspectRatio: mainPanelApi.MainPanel.prototype.warningAspectRatio,
    t(key, values) { return key + " " + values.scale; } };
  const risk = mainPanelApi.MainPanel.prototype.updateImportQualityWarning.call(panel);
  assert.equal(risk.level, "medium"); assert.equal(warning.hidden, false);
  assert.match(warning.className, /import-risk-medium/); assert.match(warning.textContent, /2\.00/);
  panel.uiStateStore.getMatchMainSize = () => false;
  assert.equal(mainPanelApi.MainPanel.prototype.updateImportQualityWarning.call(panel), null); assert.equal(warning.hidden, true);
});
