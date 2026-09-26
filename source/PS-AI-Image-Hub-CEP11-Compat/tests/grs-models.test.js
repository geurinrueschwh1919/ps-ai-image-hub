"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const zhCN = require("../client/js/i18n/zh-CN");
const { BaseProvider } = require("../client/js/providers/baseProvider");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { ProviderFactory } = require("../client/js/providers/providerFactory");
const { GenericRestProvider } = require("../client/js/providers/genericRestProvider");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { normalizeModel, normalizeModelList } = require("../client/js/providers/modelCatalog");
const {
  GrsProvider,
  GRS_MODELS,
  resolveGrsBaseUrl,
  normalizeGrsConfig,
  buildGrsHeaders,
  buildGrsHttpRequest
} = require("../client/js/providers/grsProvider");
const { GRS_NANO_MODELS, getGrsModel } = require("../client/js/providers/grsModelCatalog");
const { maskApiKey } = require("../client/js/utils/logger");
const { ErrorCodes } = require("../client/js/utils/errors");

function secretStore(value) { return { get() { return value || null; } }; }
function grsProvider(response) {
  return new GrsProvider(null, {
    secretStore: secretStore("sk-example-secret-1234"),
    apiClient: { async requestJson() { return response; } }
  });
}
function generationRequest(modelId, aspectRatio, imageSize) {
  return { modelId, prompt: "测试提示词", count: 1, aspectRatio, imageSize };
}

test("Chinese UI presents Provider concepts as API 服务", () => {
  assert.equal(zhCN.providerList, "API 服务列表");
  assert.equal(zhCN.newProvider, "新建 API 服务");
  assert.equal(zhCN.deleteProvider, "删除 API 服务");
  assert.equal(zhCN.providerName, "API 服务名称");
});

test("Internal Provider class and registry names remain unchanged", () => {
  assert.equal(BaseProvider.name, "BaseProvider");
  assert.equal(ProviderRegistry.name, "ProviderRegistry");
  assert.equal(ProviderFactory.name, "ProviderFactory");
  assert.equal(fs.existsSync(path.resolve(__dirname, "../client/js/providers/providerConfig.js")), true);
});

test("Built-in GRS model catalog contains the complete documented Nano catalog and documented GPT models", () => {
  assert.equal(GRS_NANO_MODELS.length, 11);
  assert.equal(GRS_MODELS.some((model) => model.id === "gpt-image-2"), true);
});

test("Custom Model ID can be added without changing the built-in catalog", () => {
  const provider = grsProvider({});
  const model = provider.addModel({ id: "new-model-2026", displayName: "new-model-2026", family: "nano-banana" });
  assert.equal(model.id, "new-model-2026");
  assert.equal(provider.getModel("new-model-2026").family, "nano-banana");
  assert.equal(GRS_MODELS.some((item) => item.id === "new-model-2026"), false);
});

test("Model displayName and Model ID remain separate", () => {
  assert.deepEqual(normalizeModel({ id: "nano-banana-pro", displayName: "Nano Banana Pro" }), {
    id: "nano-banana-pro", modelId: "nano-banana-pro", displayName: "Nano Banana Pro", family: null, requestFamily: null
  });
});

test("Generic REST persists a user-maintained model list", () => {
  const config = { id: "generic-models", displayName: "Generic", type: "generic-rest", baseUrl: "https://api.example.com",
    endpointPath: "/generate", modelId: "model-a", models: [{ id: "model-a", displayName: "Model A" }, { id: "model-b", displayName: "Model B" }],
    authType: "none", resultType: "url", responsePath: "result.url" };
  const provider = new GenericRestProvider(config, { apiClient: {}, secretStore: secretStore(null) });
  assert.deepEqual(provider.getModels().map((model) => [model.displayName, model.id]), [["Model A", "model-a"], ["Model B", "model-b"]]);
  assert.equal(normalizeModelList(config.models, config.modelId).length, 2);
});

test("GRS global node resolves to the documented global Base URL", () => {
  assert.equal(resolveGrsBaseUrl({ node: "global" }), "https://grsaiapi.com");
});

test("GRS China node resolves to the documented China Base URL", () => {
  assert.equal(resolveGrsBaseUrl({ node: "china" }), "https://grsai.dakka.com.cn");
});

test("GRS authentication always uses Bearer and JSON headers", () => {
  assert.deepEqual(buildGrsHeaders("sk-test-value"), { Authorization: "Bearer sk-test-value", "Content-Type": "application/json" });
});

test("nano-banana-2 request matches the documented GRS body", () => {
  const config = normalizeGrsConfig({ node: "global", modelId: "nano-banana-2" });
  const request = buildGrsHttpRequest(generationRequest("nano-banana-2", "1:1", "1K"), config, "key", getGrsModel("nano-banana-2"));
  assert.equal(request.url, "https://grsaiapi.com/v1/api/generate");
  assert.deepEqual(JSON.parse(request.body), { model: "nano-banana-2", prompt: "测试提示词", images: [], aspectRatio: "1:1", replyType: "async", imageSize: "1K" });
});

test("nano-banana-2 request includes the documented imageSize value", () => {
  const body = JSON.parse(buildGrsHttpRequest(generationRequest("nano-banana-2", "1:1", "1K"), normalizeGrsConfig(), "key", getGrsModel("nano-banana-2")).body);
  assert.equal(body.imageSize, "1K");
});

test("gpt-image-2 request matches the documented GRS main endpoint body", () => {
  const config = normalizeGrsConfig({ node: "china", modelId: "gpt-image-2" });
  const request = buildGrsHttpRequest(generationRequest("gpt-image-2", "1024x1024"), config, "key", getGrsModel("gpt-image-2"));
  assert.equal(request.url, "https://grsai.dakka.com.cn/v1/api/generate");
  assert.deepEqual(JSON.parse(request.body), { model: "gpt-image-2", prompt: "测试提示词", images: [], aspectRatio: "1024x1024", replyType: "async" });
});

test("gpt-image-2 never receives Nano Banana imageSize", () => {
  const body = JSON.parse(buildGrsHttpRequest(generationRequest("gpt-image-2", "1024x1024", "1K"), normalizeGrsConfig(), "key", getGrsModel("gpt-image-2")).body);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "imageSize"), false);
});

test("GRS succeeded response extracts results[0].url", () => {
  const provider = grsProvider({});
  const parsed = provider.parseResponse({ id: "task-1", status: "succeeded", results: [{ url: "https://files.example/result.png" }] });
  const images = provider.extractImages(parsed);
  assert.equal(images[0].previewSource, "https://files.example/result.png");
  assert.equal(images[0].importSource.type, "url");
});

test("GRS non-succeeded response exposes a recoverable async-pending error", () => {
  const provider = grsProvider({});
  assert.throws(() => provider.parseResponse({ id: "task-2", status: "processing", results: [] }),
    (error) => error.code === ErrorCodes.ASYNC_PENDING && error.details.id === "task-2");
});

test("GRS API Key masking preserves only a short prefix and suffix", () => {
  const masked = maskApiKey("sk-1234567890abcdef");
  assert.equal(masked, "sk-****cdef");
  assert.equal(masked.includes("1234567890"), false);
});

test("Existing Mock generation and import-source contract remains unchanged", async () => {
  const provider = new MockProvider({ submitDelay: 0, generationDelay: 0 });
  const response = await provider.generate({ modelId: "mock-image-v1", prompt: "回归" });
  const parsed = provider.parseResponse(response);
  assert.equal(provider.extractImages(parsed)[0].importSource.relativePath, "client/assets/mock-result.png");
});
