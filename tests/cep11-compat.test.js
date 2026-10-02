"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "source", "PS-AI-Image-Hub-CEP11-Compat");
const formalCepRoot = path.resolve(projectRoot, "..", "adobe-photoshop-uxp-ps-ai-image", "cep");
const feature = require(path.join(sourceRoot, "client/js/compat/featureDetection"));
const host = require(path.join(sourceRoot, "client/js/compat/hostCompatibility"));
const storage = require(path.join(sourceRoot, "client/js/compat/compatStorage"));
const network = require(path.join(sourceRoot, "client/js/compat/compatNetwork"));
const fileDialog = require(path.join(sourceRoot, "client/js/compat/compatFileDialog"));
const cep = require(path.join(sourceRoot, "client/js/compat/cepCompatibility"));

function scope(overrides = {}) {
  function CSInterface() {}
  CSInterface.prototype.evalScript = function evalScript() {};
  CSInterface.prototype.openURLInDefaultBrowser = function openURLInDefaultBrowser() {};
  return Object.assign({ CSInterface, cep: { fs: { showOpenDialog() {} } }, localStorage: { getItem() {}, setItem() {} },
    JSON, Promise, XMLHttpRequest: function XMLHttpRequest() {}, fetch() {}, FileReader: function FileReader() {}, Blob: function Blob() {},
    ArrayBuffer, URL, URLSearchParams, TextEncoder, TextDecoder, SystemPath: {}, crypto: { getRandomValues() {} }, navigator: { userAgent: "CEP/11.2", platform: "Win32" } }, overrides);
}

for (const major of [23, 24, 25]) test("Host " + major + " mock maps to its CEP11 profile", () => {
  assert.equal(host.compatibilityProfile({ hostName: "PHSP", hostMajor: major }), "PS" + major + "_CEP11");
});
test("Unknown Host maps to UNKNOWN_CEP11", () => assert.equal(host.compatibilityProfile({ hostName: "unknown", hostMajor: null }), "UNKNOWN_CEP11"));
test("Unsupported Host maps to UNSUPPORTED_HOST", () => assert.equal(host.compatibilityProfile({ hostName: "PHSP", hostMajor: 26 }), "UNSUPPORTED_HOST"));
test("CSInterface exists", () => assert.equal(feature.detectCepCapabilities(scope()).hasCSInterface, true));
test("CSInterface missing is detected without throwing", () => assert.equal(feature.detectCepCapabilities(scope({ CSInterface: undefined })).hasCSInterface, false));
test("evalScript missing is detected", () => { const value = scope(); delete value.CSInterface.prototype.evalScript; assert.equal(feature.detectCepCapabilities(value).hasEvalScript, false); });
test("CEP fs missing is detected", () => assert.equal(feature.detectCepCapabilities(scope({ cep: {} })).hasCepFs, false));
test("localStorage missing selects MemoryStore", () => { const value = storage.createCompatibleStorage(undefined); assert.equal(value.persistent, false); assert.ok(value.storage instanceof storage.MemoryStore); });
test("localStorage quota error selects MemoryStore", () => { const value = storage.createCompatibleStorage({ getItem() {}, setItem() { throw new Error("quota"); }, removeItem() {} }); assert.equal(value.fallback, "MemoryStore"); });
test("FileReader missing is detected", () => assert.equal(feature.detectCepCapabilities(scope({ FileReader: undefined })).hasFileReader, false));
test("Blob missing is detected", () => assert.equal(feature.detectCepCapabilities(scope({ Blob: undefined })).hasBlob, false));
test("fetch missing is detected", () => assert.equal(feature.detectCepCapabilities(scope({ fetch: undefined })).hasFetch, false));
test("XHR fallback is selected when fetch is absent", async () => {
  const transport = network.createNetworkTransport({ root: { Promise }, preferFetch: true });
  const response = await transport.request("https://example.invalid", {}, () => Promise.resolve("xhr"));
  assert.equal(response, "xhr"); assert.equal(transport.lastStrategy, "xhr");
});
test("File Dialog fallback is non-throwing", () => { const compat = fileDialog.createFileDialogCompatibility(null); assert.equal(compat.showOpenDialog(), null); assert.equal(compat.readFile("x").err, 1); });
test("Canvas capability missing is preserved", () => assert.equal(host.sanitizeHostCapabilities({ currentCanvasExport: false }).currentCanvasExport, false));
test("Selection capability missing is preserved", () => assert.equal(host.sanitizeHostCapabilities({ currentSelectionExport: false }).currentSelectionExport, false));
test("Import capability missing is preserved", () => assert.equal(host.sanitizeHostCapabilities({ layerImport: false }).layerImport, false));
test("Generate mounts in the panel source", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/js/ui/mainPanel.js"), "utf8"), /id="generate-button"/));
test("Settings mounts in the panel source", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/js/ui/mainPanel.js"), "utf8"), /new views\.SettingsPanel/));
test("History mounts in the panel source", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/js/ui/mainPanel.js"), "utf8"), /new views\.HistoryPanel/));
test("Preset modules mount", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/index.html"), "utf8"), /promptPresetStack\.js/));
test("Provider Registry mounts", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/js/app.js"), "utf8"), /new hub\.ProviderRegistry/));
test("Recovery uses the isolated USER_DATA root", () => assert.match(fs.readFileSync(path.join(sourceRoot, "client/js/storage/generationRecoveryStore.js"), "utf8"), /PSAIImageHubCompat/));
test("Provider payload implementation is unchanged apart from global namespace isolation", () => {
  const providerDirectory = path.join(sourceRoot, "client/js/providers");
  const verifiedUrlMimeFiles = ["grsProvider.js", "genericRestProvider.js", "openAICompatibleProvider.js", "asyncTaskProvider.js"];
  for (const name of fs.readdirSync(providerDirectory).filter((item) => item.endsWith(".js"))) {
    const formal = fs.readFileSync(path.join(formalCepRoot, "client/js/providers", name), "utf8");
    let compatSource = fs.readFileSync(path.join(providerDirectory, name), "utf8").replace(/PSAIImageHubCompat/g, "PSAIHub");
    if (verifiedUrlMimeFiles.includes(name)) compatSource = compatSource.replace(/mimeType: null/g,
      name === "asyncTaskProvider.js" ? "mimeType: mimeType" : 'mimeType: "image/png"');
    assert.equal(compatSource, formal, name);
  }
});
test("URL Provider results defer MIME identity until HTTP headers and magic bytes are verified", () => {
  const providerDirectory = path.join(sourceRoot, "client/js/providers");
  for (const name of ["grsProvider.js", "genericRestProvider.js", "openAICompatibleProvider.js", "asyncTaskProvider.js"]) {
    assert.match(fs.readFileSync(path.join(providerDirectory, name), "utf8"), /mimeType: null/, name);
  }
});
test("Formal runtime namespace is absent from Compat runtime", () => {
  const text = fs.readFileSync(path.join(sourceRoot, "client/js/app.js"), "utf8");
  assert.doesNotMatch(text, /root\.PSAIHub\b/);
});
test("Compat runtime and storage namespaces are isolated", () => {
  const app = fs.readFileSync(path.join(sourceRoot, "client/js/app.js"), "utf8");
  assert.match(app, /PSAIImageHubCompat/); assert.match(app, /ps-ai-image-hub\.compat\.cep11/);
});
test("Extension ID is isolated", () => {
  const manifest = fs.readFileSync(path.join(sourceRoot, "CSXS/manifest.xml"), "utf8");
  assert.match(manifest, /com\.psai\.imagehub\.compat\.cep11\.panel/); assert.doesNotMatch(manifest, /com\.psaiimagehub\.cep\.panel/);
});
test("Manifest range is exactly [23.0,26.0)", () => assert.match(fs.readFileSync(path.join(sourceRoot, "CSXS/manifest.xml"), "utf8"), /Version="\[23\.0,26\.0\)"/));
test("Diagnostic secret filtering redacts secret and image-bearing fields", () => {
  const filtered = cep.redactDiagnostics({ apiKey: "secret", Authorization: "Bearer secret", prompt: "private", imagePayload: "base64", safe: "ok" }, 0);
  assert.equal(filtered.apiKey, "[REDACTED]"); assert.equal(filtered.Authorization, "[REDACTED]"); assert.equal(filtered.prompt, "[REDACTED]"); assert.equal(filtered.safe, "ok");
});
test("startup fallback report does not crash with unknown capabilities", () => {
  assert.doesNotThrow(() => cep.createBootCompatibilityReport({ host: null, cepCapabilities: {}, hostCapabilities: {}, fallbacks: ["MemoryStore"] }));
});
