"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { GRS_NANO_MODELS, GRS_MODEL_CATALOG, GRS_STANDARD_RATIOS, GRS_NANO_2_EXTENDED_RATIOS, getGrsModel } = require("../client/js/providers/grsModelCatalog");
const { GrsProvider, buildGrsHttpRequest, normalizeGrsConfig, parseGrsTaskState, GRS_RESULT_ENDPOINT } = require("../client/js/providers/grsProvider");
const { ApiClient, API_TIMEOUTS, timeoutCodeFor } = require("../client/js/network/apiClient");
const { CancellationToken } = require("../client/js/generation/cancellationToken");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { GrsTaskStore, GRS_TASK_STORAGE_KEY } = require("../client/js/storage/grsTaskStore");
const { resolveAspectRatio, parseAspectRatioValue } = require("../client/js/generation/aspectRatioResolver");
const { ReferenceImageManager, readReferenceImageDimensions } = require("../client/js/photoshop/referenceImageManager");
const { ImageFileStore } = require("../client/js/storage/imageFileStore");
const { ErrorCodes } = require("../client/js/utils/errors");

const EXPECTED_NANO_IDS = ["nano-banana-pro", "nano-banana-fast", "nano-banana-pro-vt", "nano-banana-2", "nano-banana-2-lite", "nano-banana-pro-cl", "nano-banana-2-cl", "nano-banana-2-2k-cl", "nano-banana-pro-vip", "nano-banana-pro-4k-vip", "nano-banana-2-4k-cl"];
function secrets() { return { get() { return "sk-test-not-real"; } }; }
function memoryStorage() { const values = new Map(); return { setItem(k, v) { values.set(k, v); }, getItem(k) { return values.get(k) || null; }, removeItem(k) { values.delete(k); }, values }; }

test("Phase 7.4R-H1 timeout budgets are separated", () => assert.deepEqual(API_TIMEOUTS, { connection: 25000, generation: 600000, download: 60000 }));
test("connection timeout has a dedicated code", () => assert.equal(timeoutCodeFor("connection"), ErrorCodes.NETWORK_CONNECTION_TIMEOUT));
test("generation timeout has a dedicated code", () => assert.equal(timeoutCodeFor("generation"), ErrorCodes.GENERATION_TIMEOUT));
test("download timeout has a dedicated code", () => assert.equal(timeoutCodeFor("download"), ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT));

EXPECTED_NANO_IDS.forEach((modelId) => test("official Nano model is registered unchanged: " + modelId, () => {
  const model = getGrsModel(modelId); assert.ok(model); assert.equal(model.modelId, modelId); assert.equal(model.requestFamily, "nano-banana");
}));

test("Nano catalog has exactly eleven official IDs", () => assert.deepEqual(GRS_NANO_MODELS.map((model) => model.modelId), EXPECTED_NANO_IDS));
test("current Nano size metadata follows the current catalog without suffix inference", () => {
  assert.deepEqual(getGrsModel("nano-banana-2").supportedImageSizes, ["1K", "2K", "4K"]);
  assert.equal(getGrsModel("nano-banana-fast").supportedImageSizes, null);
  assert.equal(getGrsModel("nano-banana-2-lite").supportedImageSizes, null);
  assert.deepEqual(getGrsModel("nano-banana-2-2k-cl").supportedImageSizes, ["2K"]);
});
test("Nano 2 variants expose documented extended ratios", () => ["nano-banana-2", "nano-banana-2-cl", "nano-banana-2-2k-cl", "nano-banana-2-4k-cl"].forEach((id) => assert.deepEqual(getGrsModel(id).supportedAspectRatios, GRS_NANO_2_EXTENDED_RATIOS)));
test("other Nano variants expose the standard ratio matrix", () => assert.deepEqual(getGrsModel("nano-banana-pro").supportedAspectRatios, GRS_STANDARD_RATIOS));
test("gpt-image-2 keeps current 1K metadata without exposing Nano imageSize", () => { const model = getGrsModel("gpt-image-2"); assert.equal(model.requestFamily, "gpt-image"); assert.deepEqual(model.currentCatalogSupportedImageSizes, ["1K"]); assert.deepEqual(model.supportedImageSizes, []); });
test("every official model declares image-to-image and multiple-reference capability", () => GRS_MODEL_CATALOG.forEach((model) => { assert.equal(model.documentedCapabilities.supportsImageToImage, true); assert.equal(model.documentedCapabilities.supportsMultipleReferences, true); }));

test("GRS request maps one reference to official images array", () => {
  const body = JSON.parse(buildGrsHttpRequest({ modelId: "nano-banana-2", prompt: "p", aspectRatio: "1:1", imageSize: "2K", references: [{ apiValue: "BASE64" }] }, normalizeGrsConfig(), "k", getGrsModel("nano-banana-2")).body);
  assert.deepEqual(body.images, ["BASE64"]); assert.equal(body.imageSize, "2K");
});
test("GRS request reserves multiple references without changing Provider abstraction", () => {
  const body = JSON.parse(buildGrsHttpRequest({ modelId: "nano-banana", prompt: "p", references: [{ url: "https://a/x.png" }, { base64: "ABC" }] }, normalizeGrsConfig(), "k", getGrsModel("nano-banana")).body);
  assert.deepEqual(body.images, ["https://a/x.png", "ABC"]);
});
test("custom GRS model requires an explicit request family", () => assert.throws(() => buildGrsHttpRequest({ modelId: "custom", prompt: "p" }, normalizeGrsConfig(), "k", { id: "custom" }), (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG));
test("custom Nano-family model uses Nano body shape", () => { const body = JSON.parse(buildGrsHttpRequest({ modelId: "custom", prompt: "p", imageSize: "4K" }, normalizeGrsConfig(), "k", { id: "custom", requestFamily: "nano-banana", supportedImageSizes: ["1K", "2K", "4K"] }).body); assert.equal(body.imageSize, "4K"); });
test("custom GPT-family model omits imageSize", () => { const body = JSON.parse(buildGrsHttpRequest({ modelId: "custom", prompt: "p", imageSize: "4K" }, normalizeGrsConfig(), "k", { id: "custom", requestFamily: "gpt-image" }).body); assert.equal("imageSize" in body, false); });

test("GRS succeeded state preserves Task ID, progress, and results", () => assert.deepEqual(parseGrsTaskState({ id: "t1", status: "succeeded", progress: 100, results: [{ url: "https://x/a.png" }] }), { id: "t1", status: "succeeded", results: [{ url: "https://x/a.png" }], progress: 100, error: null }));
test("GRS async submission uses connection timeout while polling retains the 10-minute window", async () => {
  const statuses = []; let settings;
  const provider = new GrsProvider(null, { secretStore: secrets(), setInterval() { return 1; }, clearInterval() {}, apiClient: { async requestJson(url, options) { settings = options; options.onRequestStarted(); return { id: "t", status: "succeeded", progress: 100, results: [{ url: "https://x/a.png" }] }; } } });
  await provider.generate({ modelId: "nano-banana-2", prompt: "p", references: [] }, { onStatus(status) { statuses.push(status); } });
  assert.equal(settings.timeout, 25000); assert.equal(settings.timeoutContext, "connection"); assert.deepEqual(statuses.slice(0, 3), ["connecting", "requestSubmitted", "generating"]);
});
test("GRS slow generation emits 30 and 60 second wait notices without per-second UI churn", async () => {
  const statuses = []; let tick;
  const provider = new GrsProvider(null, { secretStore: secrets(), setInterval(callback) { tick = callback; return 1; }, clearInterval() {}, apiClient: { async requestJson(url, options) { options.onRequestStarted(); tick(); tick(); return { id: "t", status: "succeeded", progress: 100, results: [{ url: "https://x/a.png" }] }; } } });
  await provider.generate({ modelId: "nano-banana-2", prompt: "p" }, { onStatus(status, payload) { if (status === "waiting") statuses.push(payload.seconds); } }); assert.deepEqual(statuses, [30, 60]);
});
test("GRS result recovery uses official GET result endpoint and connection timeout", async () => {
  let called; const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson(url, options) { called = { url, options }; return { id: "task-1", status: "succeeded", results: [] }; } } });
  await provider.queryTask("task-1", {}); assert.match(called.url, new RegExp(GRS_RESULT_ENDPOINT.replace(/\//g, "\\/") + "\\?id=task-1$")); assert.equal(called.options.method, "GET"); assert.equal(called.options.timeout, 25000);
});
test("GRS recovery polls pending task into succeeded task", async () => {
  let calls = 0; const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { calls += 1; return calls === 1 ? { id: "t", status: "running", progress: 40 } : { id: "t", status: "succeeded", progress: 100, results: [{ url: "https://x/a.png" }] }; } }, pollingManager: { async poll(check) { let result = await check(1); if (!result.done) result = await check(2); return result.value; } } });
  const result = await provider.recoverTask("t", {}); assert.equal(result.status, "succeeded"); assert.equal(calls, 2);
});

test("Task store saves only minimal recovery metadata", () => { const storage = memoryStorage(), store = new GrsTaskStore({ storage }); store.save({ id: "t", status: "running", progress: 20, node: "global", baseUrl: "https://grsaiapi.com", modelId: "nano-banana-2", apiKey: "secret" }); const raw = storage.values.get(GRS_TASK_STORAGE_KEY); assert.equal(raw.includes("secret"), false); assert.equal(store.load().id, "t"); });
test("Task store safely ignores malformed JSON", () => { const storage = memoryStorage(); storage.setItem(GRS_TASK_STORAGE_KEY, "{"); assert.equal(new GrsTaskStore({ storage }).load(), null); });
test("Task store clears recovery metadata", () => { const storage = memoryStorage(), store = new GrsTaskStore({ storage }); store.save({ id: "t" }); store.clear(); assert.equal(store.load(), null); });

test("cancellation token is idempotent and notifies subscribers", () => { const token = new CancellationToken(); let calls = 0; token.subscribe(() => calls++); token.cancel(); token.cancel(); assert.equal(calls, 1); assert.equal(token.cancelled, true); });
test("ApiClient cancellation aborts active XHR", async () => { let xhr; const token = new CancellationToken(); const client = new ApiClient({ xhrFactory() { xhr = { open() {}, setRequestHeader() {}, send() {}, abort() { this.onabort(); } }; return xhr; } }); const request = client.request("https://x", { cancellationToken: token }); token.cancel(); await assert.rejects(request, (error) => error.code === ErrorCodes.CANCELLED); });
test("ApiClient maps CORS-aware transport failure", async () => { let xhr; const client = new ApiClient({ xhrFactory() { xhr = { open() {}, setRequestHeader() {}, send() { this.onerror(); } }; return xhr; } }); await assert.rejects(client.request("https://x", { corsAware: true }), (error) => error.code === ErrorCodes.CORS_ERROR); });
test("ApiClient maps an actual generation timer to GENERATION_TIMEOUT", async () => { const client = new ApiClient({ xhrFactory() { return { open() {}, setRequestHeader() {}, send() { this.ontimeout(); } }; } }); await assert.rejects(client.request("https://x", { timeout: 600000, timeoutContext: "generation" }), (error) => error.code === ErrorCodes.GENERATION_TIMEOUT && error.details.timeout === 600000); });
test("ApiClient maps an actual image timer to IMAGE_DOWNLOAD_TIMEOUT", async () => { const client = new ApiClient({ xhrFactory() { return { open() {}, setRequestHeader() {}, send() { this.ontimeout(); } }; } }); await assert.rejects(client.requestArrayBuffer("https://x/a.png"), (error) => error.code === ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT); });
test("PollingManager cancellation prevents later task queries", async () => { const token = new CancellationToken(); token.cancel(); await assert.rejects(new PollingManager().poll(async () => ({ done: false }), { cancellationToken: token }), (error) => error.code === ErrorCodes.CANCELLED); });

test("ratio resolver reads colon and pixel forms", () => { assert.equal(parseAspectRatioValue("16:9"), 16 / 9); assert.equal(parseAspectRatioValue("1024x1536"), 2 / 3); });
test("ratio resolver chooses nearest landscape ratio", () => assert.equal(resolveAspectRatio(1600, 900, ["1:1", "16:9", "9:16"]), "16:9"));
test("ratio resolver chooses nearest portrait ratio", () => assert.equal(resolveAspectRatio(800, 1200, ["1:1", "3:2", "2:3"]), "2:3"));
test("ratio resolver maps a square to 1:1", () => assert.equal(resolveAspectRatio(3543, 3543, ["1:1", "4:3"]), "1:1"));
test("ratio resolver includes documented extended ratios", () => assert.equal(resolveAspectRatio(1000, 8000, GRS_NANO_2_EXTENDED_RATIOS), "1:8"));
test("ratio resolver returns null for unusable dimensions", () => assert.equal(resolveAspectRatio(0, 100, ["1:1"]), null));

test("reference reader verifies PNG magic bytes and dimensions", () => { const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20); assert.deepEqual(readReferenceImageDimensions(png, "image/png"), { width: 640, height: 480 }); });
test("local reference is converted to raw Base64 for official images array", () => { const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(10,16); png.writeUInt32BE(20,20); const manager = new ReferenceImageManager({ photoshopBridge: {}, cepFs: { readFile() { return { err: 0, data: png.toString("base64") }; } }, base64Encoding: "base64" }); const ref = manager.readReference("x.png"); assert.equal(ref.apiValue, png.toString("base64")); assert.equal(ref.width, 10); assert.equal(ref.height, 20); });
test("local reference rejects non-image magic bytes", () => { const manager = new ReferenceImageManager({ photoshopBridge: {}, cepFs: { readFile() { return { err: 0, data: Buffer.from("text").toString("base64") }; } }, base64Encoding: "base64" }); assert.throws(() => manager.readReference("x.png"), (error) => error.code === ErrorCodes.UNSUPPORTED_IMAGE_FILE); });
test("reference removal deletes only a transient exported reference", () => { let removed = null; const manager = new ReferenceImageManager({ photoshopBridge: {}, cepFs: { deleteFile(pathValue) { removed = pathValue; } } }); manager.remove({ transient: true, path: "temp.png" }); assert.equal(removed, "temp.png"); removed = null; manager.remove({ transient: false, path: "user.png" }); assert.equal(removed, null); });
test("download materialization rejects Content-Type and magic-byte mismatch", async () => { const png = Buffer.from([137,80,78,71,13,10,26,10]); const store = new ImageFileStore({ photoshopBridge: {}, apiClient: { async requestArrayBuffer() { return { bytes: png, mimeType: "image/jpeg" }; } } }); await assert.rejects(store.materialize({ type: "url", url: "https://x/a" }), (error) => error.code === ErrorCodes.UNSUPPORTED_RESULT_FORMAT); });

test("dark dropdown CSS remains Photoshop-readable", () => { const css = fs.readFileSync(path.resolve(__dirname, "../client/css/main.css"), "utf8"); assert.match(css, /dark-select-menu/); assert.match(css, /#242424/); assert.match(css, /aria-selected/); });
test("all native selects are enhanced by lightweight vanilla JavaScript", () => { const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/darkSelect.js"), "utf8"); assert.match(source, /querySelectorAll\("select"\)/); assert.doesNotMatch(source, /React|Vue|eval\s*\(/); });
test("main panel exposes local, canvas, selection, cancellation and recovery controls", () => { const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8"); ["reference-local", "reference-canvas", "reference-selection", "cancel-generation", "recover-task"].forEach((id) => assert.match(source, new RegExp(id))); });

function loadReferenceHost(overrides) {
  const source = fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8");
  const context = Object.assign({ isFinite, parseInt, Error }, overrides); vm.createContext(context); vm.runInContext(source, context); return context;
}
test("selection reference export duplicates, crops, flattens, and closes only the temporary document", () => {
  let cropped = false, flattened = false, closed = false, originalTouched = false;
  const unit = (value) => ({ as() { return value; } });
  const temporary = { width: 100, height: 80, layers: [{}, {}], crop() { cropped = true; this.width = 50; this.height = 40; }, flatten() { flattened = true; this.layers = [{}]; }, saveAs(file) { file.exists = true; }, close() { closed = true; } };
  const original = { name: "source.psd", width: unit(100), height: unit(80), selection: { bounds: [unit(10), unit(20), unit(60), unit(60)] }, duplicate() { return temporary; }, crop() { originalTouched = true; }, flatten() { originalTouched = true; } };
  const app = { documents: [original], activeDocument: original };
  const host = loadReferenceHost({ app, File: function File(pathValue) { return { exists: false, fsName: pathValue, remove() {} }; }, PNGSaveOptions: function PNGSaveOptions() {}, Extension: { LOWERCASE: 1 }, SaveOptions: { DONOTSAVECHANGES: 0 } });
  const result = JSON.parse(host.PSAIImageHubCompatHost.exportReferenceImage("selection", "C:\\temp\\ref.png"));
  assert.equal(result.ok, true); assert.deepEqual([result.data.width, result.data.height], [50, 40]); assert.equal(cropped, true); assert.equal(flattened, true); assert.equal(closed, true); assert.equal(originalTouched, false); assert.equal(app.activeDocument, original);
});
test("selection reference export reports a stable no-selection error", () => {
  const original = { selection: { get bounds() { throw new Error("none"); } } };
  const host = loadReferenceHost({ app: { documents: [original], activeDocument: original } });
  const result = JSON.parse(host.PSAIImageHubCompatHost.exportReferenceImage("selection", "C:\\temp\\ref.png")); assert.equal(result.ok, false); assert.equal(result.error.code, "NO_PHOTOSHOP_SELECTION");
});
test("canvas reference export uses a duplicate and leaves the original document unchanged", () => {
  let closed = false, originalTouched = false; const temporary = { width: 320, height: 200, layers: [{}], saveAs(file) { file.exists = true; }, close() { closed = true; } };
  const original = { name: "source.psd", duplicate() { return temporary; }, crop() { originalTouched = true; }, flatten() { originalTouched = true; } };
  const app = { documents: [original], activeDocument: original };
  const host = loadReferenceHost({ app, File: function File(pathValue) { return { exists: false, fsName: pathValue, remove() {} }; }, PNGSaveOptions: function PNGSaveOptions() {}, Extension: { LOWERCASE: 1 }, SaveOptions: { DONOTSAVECHANGES: 0 } });
  const result = JSON.parse(host.PSAIImageHubCompatHost.exportReferenceImage("canvas", "C:\\temp\\canvas.png")); assert.equal(result.ok, true); assert.equal(result.data.width, 320); assert.equal(closed, true); assert.equal(originalTouched, false); assert.equal(app.activeDocument, original);
});
