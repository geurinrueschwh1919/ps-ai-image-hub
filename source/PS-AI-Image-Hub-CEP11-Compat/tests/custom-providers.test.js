"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProviderConfig } = require("../client/js/providers/providerConfig");
const builders = require("../client/js/generation/requestBuilder");
const { getByPath } = require("../client/js/utils/objectPath");
const { OpenAICompatibleProvider } = require("../client/js/providers/openAICompatibleProvider");
const { GenericRestProvider } = require("../client/js/providers/genericRestProvider");
const { AsyncTaskProvider } = require("../client/js/providers/asyncTaskProvider");
const { ApiClient } = require("../client/js/network/apiClient");
const { ImageNormalizer } = require("../client/js/generation/imageNormalizer");
const { ImageFileStore } = require("../client/js/storage/imageFileStore");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { ProviderManager } = require("../client/js/ui/providerManager");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { createTranslator } = require("../client/js/i18n");
const { redact } = require("../client/js/utils/logger");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");

const pngBytes = fs.readFileSync(path.resolve(__dirname, "../client/assets/mock-result.png"));
const pngBase64 = pngBytes.toString("base64");

function secretStore(value) {
  return { get() { return value || null; } };
}

function baseConfig(overrides) {
  return Object.assign({
    id: "real-test", displayName: "Real Test", type: "openai-compatible",
    baseUrl: "https://api.openai.com", endpointPath: "/v1/images/generations",
    modelId: "official-model-id-from-user", authType: "bearer", resultType: "auto"
  }, overrides || {});
}

test("Provider config validation covers identity, endpoint and model fields", () => {
  assert.equal(validateProviderConfig(baseConfig(), true).valid, true);
  const invalid = validateProviderConfig(baseConfig({ baseUrl: "", endpointPath: "" }), true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length >= 2, true);
});

test("OpenAI-compatible request builder follows the documented Images JSON contract", () => {
  const request = builders.buildOpenAICompatibleHttpRequest({ modelId: "unchanged-model-id", prompt: "山谷", count: 1, aspectRatio: "16:9" }, baseConfig(), "secret-value");
  assert.equal(request.url, "https://api.openai.com/v1/images/generations");
  assert.equal(request.headers.Authorization, "Bearer secret-value");
  assert.deepEqual(JSON.parse(request.body), { model: "unchanged-model-id", prompt: "山谷", n: 1, size: "1536x1024", output_format: "png" });
});

test("Generic REST request builder renders JSON placeholders without eval", () => {
  const request = builders.buildGenericRestHttpRequest({ modelId: "m/1", prompt: "a \"quote\"", aspectRatio: "3:4", count: 2 },
    baseConfig({ type: "generic-rest", requestBodyTemplate: '{"input":{"text":"{{prompt}}"},"model":"{{modelId}}","count":"{{count}}"}', responsePath: "result.url" }), "key");
  assert.deepEqual(JSON.parse(request.body), { input: { text: "a \"quote\"" }, model: "m/1", count: 2 });
  assert.throws(() => builders.renderJsonBody("{invalid", {}), (error) => error.code === ErrorCodes.INVALID_REQUEST_TEMPLATE);
});

test("Header builder supports Bearer, x-api-key and a validated custom header", () => {
  assert.equal(builders.buildHeaders({ authType: "bearer" }, "k").Authorization, "Bearer k");
  assert.equal(builders.buildHeaders({ authType: "x-api-key" }, "k")["x-api-key"], "k");
  assert.equal(builders.buildHeaders({ authType: "custom-header", customHeaderName: "X-Service-Key" }, "k")["X-Service-Key"], "k");
  assert.throws(() => builders.buildHeaders({ authType: "custom-header", customHeaderName: "Bad Header" }, "k"), (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG);
});

test("Response path extraction supports data[0].url and rejects unsafe paths", () => {
  assert.equal(getByPath({ data: [{ url: "https://images.example/result.png" }] }, "data[0].url"), "https://images.example/result.png");
  assert.throws(() => getByPath({}, "data[bad].url"), (error) => error.code === ErrorCodes.INVALID_JSON_PATH);
  assert.throws(() => getByPath({}, "constructor.prototype"), (error) => error.code === ErrorCodes.INVALID_JSON_PATH);
});

test("URL results normalize to one provider-neutral preview/import contract", () => {
  const image = new ImageNormalizer().normalize({ url: "https://images.example/result.png", importSource: { type: "url", url: "https://images.example/result.png" } });
  assert.equal(image.previewSource, "https://images.example/result.png");
  assert.equal(image.importSource.type, "url");
});

test("OpenAI-compatible Base64 response normalizes for preview and local materialization", async () => {
  const provider = new OpenAICompatibleProvider(baseConfig(), { apiClient: {}, secretStore: secretStore("key") });
  const images = provider.extractImages({ created: 123, data: [{ b64_json: pngBase64 }] });
  const image = new ImageNormalizer().normalize(images[0]);
  assert.match(image.previewSource, /^data:image\/png;base64,/);
  assert.equal(image.importSource.type, "base64");
  assert.deepEqual(image.rawResponseMeta, { created: 123 });
});

test("Async Task Provider executes a configured async definition without a placeholder", async () => {
  const provider = new AsyncTaskProvider(baseConfig({ type: "async-task", responsePath: "task_id", pollingEndpoint: "/tasks/{{taskId}}", pollingResultPath: "result.url" }), {
    secretStore: secretStore("key"),
    apiClient: { async requestJson() { return { task_id: "task-test", status: "succeeded", result: { url: "https://images.example/result.png" } }; } }
  });
  assert.equal(provider.validateConfig().valid, true);
  const response = await provider.generate({ modelId: "official-model-id-from-user", prompt: "test", aspectRatio: "1:1", count: 1 });
  assert.equal(response.task_id, "task-test");
  assert.equal(provider.extractImages(provider.parseResponse(response))[0].importSource.type, "url");
});

test("Missing API key has a stable error code before any network request", async () => {
  const provider = new OpenAICompatibleProvider(baseConfig(), { apiClient: { requestJson() { throw new Error("must not run"); } }, secretStore: secretStore(null) });
  assert.equal(provider.validateConfig().code, ErrorCodes.MISSING_API_KEY);
  await assert.rejects(provider.generate({ modelId: "m", prompt: "p" }), (error) => error.code === ErrorCodes.MISSING_API_KEY);
});

test("ApiClient maps transport failure and timeout separately", async () => {
  function xhrFor(eventName) {
    return { open() {}, setRequestHeader() {}, send() { this[eventName](); } };
  }
  await assert.rejects(new ApiClient({ xhrFactory: () => xhrFor("onerror") }).request("https://api.example"), (error) => error.code === ErrorCodes.NETWORK);
  await assert.rejects(new ApiClient({ xhrFactory: () => xhrFor("ontimeout") }).request("https://api.example"), (error) => error.code === ErrorCodes.NETWORK_TIMEOUT);
});

test("ApiClient maps HTTP 4xx and HTTP 5xx without exposing request headers", async () => {
  function xhrWithStatus(status) {
    return { status, responseText: '{"error":"safe"}', open() {}, setRequestHeader() {}, send() { this.onload(); } };
  }
  await assert.rejects(new ApiClient({ xhrFactory: () => xhrWithStatus(401) }).request("https://api.example", { headers: { Authorization: "Bearer secret" } }),
    (error) => error.code === ErrorCodes.HTTP_CLIENT && error.details.status === 401 && !JSON.stringify(error.details).includes("secret"));
  await assert.rejects(new ApiClient({ xhrFactory: () => xhrWithStatus(503) }).request("https://api.example"),
    (error) => error.code === ErrorCodes.HTTP_SERVER && error.details.status === 503);
});

test("URL download writes a transient PNG through CEP fs without Node.js", async () => {
  const writes = [];
  const store = new ImageFileStore({
    photoshopBridge: { getUserDataRoot() { return "D:\\Fixture\\UserData"; } },
    apiClient: { async requestArrayBuffer() { return { bytes: pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength), mimeType: "image/png" }; } },
    cepFs: { makedir() { return { err: 0 }; }, writeFile(file, data, encoding) { writes.push({ file, data, encoding }); return { err: 0 }; }, deleteFile() { return { err: 0 }; } },
    base64Encoding: "base64"
  });
  const file = await store.materialize({ type: "url", url: "https://images.example/result.png" });
  assert.match(file.path, /PSAIImageHubCompat\\generated-.*\.png$/);
  assert.equal(writes[0].data, pngBase64);
  assert.equal(file.transient, true);
});

function createUrlGeneration(imageFileStore, bridgeImport) {
  const provider = new GenericRestProvider(baseConfig({ type: "generic-rest", responsePath: "result.url", resultType: "url" }), {
    secretStore: secretStore("key"), apiClient: { async requestJson() { return { result: { url: "https://images.example/result.png" } }; } }
  });
  const registry = new ProviderRegistry(); registry.register(provider);
  const bridge = { isAvailable() { return true; }, importImage: bridgeImport };
  const importer = new ImageImporter({ photoshopBridge: bridge, imageFileStore });
  return new GenerationManager({ providerManager: new ProviderManager(registry), imageImporter: importer, t: createTranslator("zh-CN") });
}

test("Generation success plus download success plus Photoshop import success preserves state order", async () => {
  const removed = [];
  const manager = createUrlGeneration({ async materialize() { return { path: "C:\\temp\\result.png", transient: true }; }, remove(file) { removed.push(file); } },
    async () => ({ imported: true, layerName: "AI_Generated_008", documentName: "test.psd" }));
  const statuses = [];
  const result = await manager.generateOneClick({ providerId: "real-test", modelId: "official-model-id-from-user", prompt: "测试", autoImport: true }, { onStatus(status) { statuses.push(status); } });
  assert.equal(result.importState, "imported");
  assert.deepEqual(statuses, ["validating", "submitting", "completed", "downloading", "importing", "imported"]);
  assert.deepEqual(removed, ["C:\\temp\\result.png"]);
});

test("Generation success plus image download failure retains preview and retry state", async () => {
  const manager = createUrlGeneration({ async materialize() { throw new AppError(ErrorCodes.IMAGE_DOWNLOAD_FAILED, "failed"); }, remove() {} }, async () => null);
  const result = await manager.generateOneClick({ providerId: "real-test", modelId: "official-model-id-from-user", prompt: "测试", autoImport: true });
  assert.equal(result.importState, "failed");
  assert.equal(result.importError.code, ErrorCodes.IMAGE_DOWNLOAD_FAILED);
  assert.equal(result.images[0].previewSource, "https://images.example/result.png");
});

test("Generation success plus Photoshop import failure keeps generated image available", async () => {
  const manager = createUrlGeneration({ async materialize() { return { path: "C:\\temp\\result.png", transient: true }; }, remove() {} },
    async () => { throw new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "failed"); });
  const result = await manager.generateOneClick({ providerId: "real-test", modelId: "official-model-id-from-user", prompt: "测试", autoImport: true });
  assert.equal(result.importState, "failed");
  assert.equal(result.importError.code, ErrorCodes.PHOTOSHOP_IMPORT);
  assert.equal(result.images.length, 1);
});

test("Secret masking removes credential fields and Bearer values from log payloads", () => {
  const value = redact({ apiKey: "sk-supersecret123", message: "Authorization: Bearer abc.def", safe: "model-id" });
  assert.equal(value.apiKey, "sk-****t123");
  assert.equal(value.message.includes("abc.def"), false);
  assert.equal(value.safe, "model-id");
});
