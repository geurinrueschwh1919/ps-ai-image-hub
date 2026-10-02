"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ImageFileStore } = require("../client/js/storage/imageFileStore");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { ErrorCodes } = require("../client/js/utils/errors");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");
const { GrsProvider } = require("../client/js/providers/grsProvider");
require("../client/js/ui/mainPanel");
const MainPanel = global.PSAIImageHubCompat.MainPanel;
const HOST_SOURCE = fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8");

const PNG = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const JPEG = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,255,217]);
const JPEG_WITH_TRAILING_DATA = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,255,217,1,2,3,4]);
const CORRUPT_JPEG = Uint8Array.from([255,216,255,224,0,16,74,70]);
const WEBP = Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80]);
const HTML = Uint8Array.from(Buffer.from("<html>not an image</html>"));

function memoryFs() {
  const files = new Map();
  return { files, makedir() { return { err: 0 }; }, stat() { return { err: 0 }; },
    writeFile(file, data) { files.set(file, data); return { err: 0 }; },
    readFile(file) { return files.has(file) ? { err: 0, data: files.get(file) } : { err: 2 }; },
    deleteFile(file) { files.delete(file); return { err: 0 }; } };
}

function imageStore(bytes, mimeType) {
  const cepFs = memoryFs();
  return { cepFs, store: new ImageFileStore({ photoshopBridge: { getUserDataRoot() { return "C:\\UserData"; } },
    apiClient: { async requestArrayBuffer() { return { bytes, mimeType }; } }, cepFs, base64Encoding: "base64" }) };
}
function hostWithFile(fileName, bytes) {
  const target = { name: "target.psd", width: 1000, height: 1000, layers: [], activeLayer: null };
  const sourceLayer = { name: "source", typename: "ArtLayer", bounds: [0,0,10,10], duplicate(document) { const copy = { name: this.name, typename: "ArtLayer", bounds: this.bounds }; document.layers.unshift(copy); document.activeLayer = copy; return copy; } };
  const source = { layers: [sourceLayer], activeLayer: sourceLayer, close() {} };
  function TestFile(filePath) { let position = 0; const binary = Buffer.from(bytes).toString("latin1"); return { exists: true, name: fileName, fsName: filePath, encoding: "UTF-8",
    open() { position = 0; return true; }, read(count) { const value = binary.slice(position, position + count); position += value.length; return value; },
    seek(offset, mode) { const next = mode === 2 ? binary.length - offset : mode === 1 ? position + offset : offset;
      if (next < 0 || next > binary.length) return false; const changed = next !== position; position = next; return changed; },
    tell() { return position; }, close() {} }; }
  const context = { isFinite, parseInt, Error, File: TestFile, ElementPlacement: { PLACEATBEGINNING: "begin" }, SaveOptions: { DONOTSAVECHANGES: "no" },
    app: { documents: [target], activeDocument: target, open() { this.activeDocument = source; return source; } } };
  vm.createContext(context); vm.runInContext(HOST_SOURCE, context); return context;
}

for (const url of ["https://safe.invalid/result.jpeg", "https://safe.invalid/result.jpg", "https://safe.invalid/download", "https://safe.invalid/result.png?token=redacted"]) {
  test("JPEG download uses magic bytes instead of URL suffix: " + url.split("?")[0].split("/").pop(), async () => {
    const fixture = imageStore(JPEG, "image/jpeg");
    const result = await fixture.store.materialize({ type: "url", url });
    assert.equal(result.mimeType, "image/jpeg");
    assert.match(result.path, /\.jpg$/);
    assert.equal(fixture.cepFs.files.get(result.path), Buffer.from(JPEG).toString("base64"));
  });
}

test("PNG remains a byte-for-byte PNG file", async () => {
  const fixture = imageStore(PNG, "image/png");
  const result = await fixture.store.materialize({ type: "url", url: "https://safe.invalid/no-extension" });
  assert.equal(result.mimeType, "image/png"); assert.match(result.path, /\.png$/);
  assert.equal(fixture.cepFs.files.get(result.path), Buffer.from(PNG).toString("base64"));
});

test("completed JPEG write is verified byte-for-byte by decoded length", async () => {
  const fixture = imageStore(JPEG, "image/jpeg");
  const result = await fixture.store.materialize({ type: "url", url: "https://safe.invalid/result.jpg" });
  assert.equal(result.byteLength, JPEG.length);
  assert.equal(Buffer.from(fixture.cepFs.files.get(result.path), "base64").length, JPEG.length);
});

test("short local write is rejected and the partial file is removed", async () => {
  const cepFs = memoryFs();
  cepFs.writeFile = function writeTruncated(file, data) { this.files.set(file, data.slice(0, -4)); return { err: 0 }; };
  const store = new ImageFileStore({ photoshopBridge: { getUserDataRoot() { return "C:\\UserData"; } },
    apiClient: { async requestArrayBuffer() { return { bytes: JPEG, mimeType: "image/jpeg" }; } }, cepFs, base64Encoding: "base64" });
  await assert.rejects(store.materialize({ type: "url", url: "https://safe.invalid/result.jpg" }),
    (error) => error.code === ErrorCodes.TEMP_FILE_WRITE_FAILED && error.details.expectedByteLength === JPEG.length);
  assert.equal(cepFs.files.size, 0);
});

test("Content-Type and magic mismatch is rejected without exposing a signed URL", async () => {
  const fixture = imageStore(JPEG, "image/png");
  await assert.rejects(fixture.store.materialize({ type: "url", url: "https://safe.invalid/file?secret=do-not-log" }), (error) => {
    assert.equal(error.code, ErrorCodes.UNSUPPORTED_RESULT_FORMAT);
    assert.equal(JSON.stringify(error).includes("do-not-log"), false); return true;
  });
});

test("corrupt JPEG, HTML and WebP are rejected accurately", async () => {
  await assert.rejects(imageStore(CORRUPT_JPEG, "image/jpeg").store.materialize({ type: "url", url: "https://safe.invalid/a" }),
    (error) => error.code === ErrorCodes.INVALID_IMAGE_FILE);
  await assert.rejects(imageStore(HTML, "text/html").store.materialize({ type: "url", url: "https://safe.invalid/b" }),
    (error) => error.code === ErrorCodes.UNSUPPORTED_RESULT_FORMAT);
  await assert.rejects(imageStore(WEBP, "image/webp").store.materialize({ type: "url", url: "https://safe.invalid/c" }),
    (error) => error.code === ErrorCodes.UNSUPPORTED_IMAGE_FILE && error.details.mimeType === "image/webp");
});

test("GRS URL metadata is not falsely fixed to PNG", () => {
  const provider = new GrsProvider({}, { secretStore: { get() { return "test-only"; } }, apiClient: {} });
  const images = provider.extractImages({ id: "task", status: "succeeded", progress: 100, results: [{ url: "https://safe.invalid/result.jpeg" }] });
  assert.equal(images[0].mimeType, null);
});

test("History persists JPEG with its true extension and MIME and keeps old PNG compatibility", async () => {
  const cepFs = memoryFs();
  const history = new HistoryStore({ rootPath: "C:\\UserData", cepFs, base64Encoding: "base64",
    photoshoBridge: {}, apiClient: { async requestArrayBuffer(url) { return url.endsWith(".jpg")
      ? { bytes: JPEG, mimeType: "image/jpeg" } : { bytes: PNG, mimeType: "image/png" }; } } });
  const jpegEntry = await history.recordSuccess({ providerId: "grs", modelId: "nano-banana-fast" },
    { images: [{ importSource: { type: "url", url: "https://safe.invalid/result.jpg" } }] });
  assert.match(jpegEntry.localResultFile, /\.jpg$/); assert.equal(jpegEntry.localResultMimeType, "image/jpeg");
  const pngEntry = await history.recordSuccess({ providerId: "mock", modelId: "mock" },
    { images: [{ importSource: { type: "url", url: "https://safe.invalid/result.png" } }] });
  assert.match(pngEntry.localResultFile, /\.png$/); assert.equal(pngEntry.localResultMimeType, "image/png");
});

test("History re-import uses original JPEG and can redownload a valid failed-entry URL", async () => {
  const captured = [];
  const panel = { generationManager: { async importGeneratedResult(result) { captured.push(result.images[0]); result.importResult = { importContext: null }; } },
    historyStore: { markImported() {} }, historyPanel: { refresh() {} }, handlePipelineStatus() {}, t(key) { return key; } };
  const prior = global.PSAIImageHubCompat.historyFileUrl;
  global.PSAIImageHubCompat.historyFileUrl = (file) => "file:///" + file;
  try {
    await MainPanel.prototype.reimportHistoryEntry.call(panel, { id: "jpeg", localResultFile: "C:\\history\\original.jpg", localResultMimeType: "image/jpeg" });
    await MainPanel.prototype.reimportHistoryEntry.call(panel, { id: "remote", resultUrl: "https://safe.invalid/result.jpeg" });
  } finally { global.PSAIImageHubCompat.historyFileUrl = prior; }
  assert.equal(captured[0].mimeType, "image/jpeg"); assert.equal(captured[0].importSource.type, "local-file");
  assert.equal(captured[1].mimeType, null); assert.equal(captured[1].importSource.type, "url");
});

test("Host validates PNG/JPEG signatures and no user message contains stale Mock-only wording", () => {
  const host = fs.readFileSync(path.resolve(__dirname, "../host/host.jsx"), "utf8");
  assert.match(host, /assertSupportedImageFile/); assert.match(host, /\\\.jpe\?g\$/); assert.match(host, /255[\s\S]*216[\s\S]*217/);
  assert.doesNotMatch(host, /Only PNG files|Mock import phase/);
  assert.doesNotMatch(zhCN.errorUnsupportedImageFile, /Mock/); assert.doesNotMatch(enUS.errorUnsupportedImageFile, /Mock/);
});
test("Host imports standard and trailing-data JPEG through real ExtendScript seek semantics", () => {
  const valid = JSON.parse(hostWithFile("result.jpg", JPEG).PSAIImageHubCompatHost.importImage("C:\\result.jpg"));
  assert.equal(valid.ok, true);
  const trailing = JSON.parse(hostWithFile("结果 图像.jpeg", JPEG_WITH_TRAILING_DATA).PSAIImageHubCompatHost.importImage("C:\\中文 路径\\结果 图像.jpeg"));
  assert.equal(trailing.ok, true);
});

test("Host keeps PNG support and rejects empty, truncated and extension-spoofed files", () => {
  const png = JSON.parse(hostWithFile("result.png", PNG).PSAIImageHubCompatHost.importImage("C:\\result.png"));
  assert.equal(png.ok, true);
  const spoofed = JSON.parse(hostWithFile("result.png", JPEG).PSAIImageHubCompatHost.importImage("C:\\result.png"));
  assert.equal(spoofed.error.code, "INVALID_IMAGE_FILE");
  const jpegSpoof = JSON.parse(hostWithFile("result.jpg", PNG).PSAIImageHubCompatHost.importImage("C:\\result.jpg"));
  assert.equal(jpegSpoof.error.code, "INVALID_IMAGE_FILE");
  const empty = JSON.parse(hostWithFile("result.jpg", Uint8Array.from([])).PSAIImageHubCompatHost.importImage("C:\\result.jpg"));
  assert.equal(empty.error.code, "INVALID_IMAGE_FILE");
  const corrupt = JSON.parse(hostWithFile("result.jpg", CORRUPT_JPEG).PSAIImageHubCompatHost.importImage("C:\\result.jpg"));
  assert.equal(corrupt.error.code, "INVALID_IMAGE_FILE");
});
