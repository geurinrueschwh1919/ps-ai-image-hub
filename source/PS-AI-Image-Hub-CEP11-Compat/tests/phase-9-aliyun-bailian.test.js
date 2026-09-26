"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const builder = require("../client/js/providers/aliyunBailianRequestBuilder");
const bailianDefinitions = require("../client/js/providers/aliyunBailianDefinition");
const asyncDefinitions = require("../client/js/providers/asyncTaskDefinition");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { AsyncTaskStore, ASYNC_TASK_STORAGE_KEY } = require("../client/js/storage/asyncTaskStore");
const { ProviderStore } = require("../client/js/storage/providerStore");
const { SecretStore } = require("../client/js/storage/secretStore");
const { ImagePayloadOptimizer } = require("../client/js/generation/imagePayloadOptimizer");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { AppError, ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const zhCN = require("../client/js/i18n/zh-CN");
const { createTranslator } = require("../client/js/i18n");
const { createNetworkSafetyGuard } = require("./helpers/networkSafetyGuard");

const FIXTURES = path.resolve(__dirname, "fixtures/phase9");
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8")); }
function memoryStorage() {
  const values = new Map();
  return { values, getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}
function taskStore(storage) { return new AsyncTaskStore({ storage: storage || memoryStorage() }); }
function secretStore(value) { return { get(name) { assert.equal(name, "provider:aliyun-bailian:apiKey"); return value || null; } }; }
function config(overrides) {
  return Object.assign({ region: "cn-beijing", workspaceId: "workspace-test", modelId: "qwen-image-3.0" }, overrides || {});
}
function providerWith(responses, overrides) {
  const settings = overrides || {};
  const apiClient = settings.apiClient || createNetworkSafetyGuard(responses || []);
  const storage = settings.storage || memoryStorage();
  const store = settings.taskStore || taskStore(storage);
  const provider = new AliyunBailianProvider(config(settings.config), {
    apiClient,
    secretStore: secretStore(settings.apiKey === undefined ? "test-api-key" : settings.apiKey),
    asyncTaskStore: store,
    pollingManager: settings.pollingManager || new PollingManager({ wait: () => Promise.resolve() })
  });
  return { provider, apiClient, store, storage };
}
function image(id, mimeType) {
  return { id, mimeType: mimeType || "image/png", width: 1024, height: 1024, base64: "QUJD", apiValue: "QUJD" };
}
function request(overrides) {
  return Object.assign({ providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "一只猫", aspectRatio: "1:1",
    resolutionTier: "1K", count: 1, imageInputs: { mainImage: null, referenceImages: [] },
    negativePrompt: "", promptExtend: true, promptExtendMode: "direct", enableThinking: true, seed: "" }, overrides || {});
}

test("Provider registry exposes built-in 阿里云百炼 and only two Phase 9 models", () => {
  const registry = new ProviderRegistry(); registry.register(new MockProvider()); registry.register(providerWith([]).provider);
  assert.equal(registry.get("aliyun-bailian").displayName, "阿里云百炼");
  assert.deepEqual(registry.get("aliyun-bailian").getModels().map((model) => model.id), ["qwen-image-3.0", "qwen-image-3.0-pro"]);
  assert.equal(registry.get("mock").id, "mock");
});

test("model catalog declares documented Qwen Image capabilities without mask or server cancel", () => {
  catalog.ALIYUN_BAILIAN_MODEL_CATALOG.forEach((model) => {
    assert.equal(model.supportsTextToImage, true); assert.equal(model.supportsImageToImage, true);
    assert.equal(model.maxInputImages, 3); assert.equal(model.outputFormat, "png");
    assert.equal(model.supportsNegativePrompt, true); assert.equal(model.supportsSeed, true);
  });
  const capabilities = providerWith([]).provider.getCapabilities();
  assert.equal(capabilities.supportsMask, false); assert.equal(capabilities.supportsServerCancel, false);
});

test("Provider model selection is stored independently inside Bailian config", () => {
  const setup = providerWith([]); setup.provider.updateConfig(config({ modelId: "qwen-image-3.0-pro" }));
  assert.equal(setup.provider.config.modelId, "qwen-image-3.0-pro");
  assert.equal(new MockProvider().getModels()[0].id, "mock-image-v1");
});

test("Beijing Workspace endpoint construction trims config and rejects unsafe host labels", () => {
  const normalized = catalog.normalizeAliyunBailianConfig({ workspaceId: "  workspace-test  ", region: "cn-beijing" });
  assert.equal(normalized.workspaceId, "workspace-test");
  assert.equal(normalized.baseUrl, "https://workspace-test.cn-beijing.maas.aliyuncs.com");
  assert.equal(catalog.resolveAliyunBailianBaseUrl("cn-beijing", "bad/path"), "");
});

test("Provider validation requires Workspace ID and API Key separately", () => {
  assert.equal(providerWith([], { config: { workspaceId: "" } }).provider.validateConfig().valid, false);
  const missingKey = providerWith([], { apiKey: null }).provider.validateConfig();
  assert.equal(missingKey.valid, false); assert.equal(missingKey.code, ErrorCodes.BAILIAN_API_KEY_REQUIRED);
});

test("API Key uses existing SecretStore semantics while Workspace remains normal config", () => {
  const session = memoryStorage(); const persistenceValues = new Map();
  const persistence = { set(key, value) { persistenceValues.set(key, value); }, get(key) { return persistenceValues.get(key) || null; }, remove(key) { persistenceValues.delete(key); }, has(key) { return persistenceValues.has(key); } };
  const secrets = new SecretStore({ storage: session, persistence });
  secrets.set("provider:aliyun-bailian:apiKey", "secret-value", { remember: true });
  assert.equal(secrets.get("provider:aliyun-bailian:apiKey"), "secret-value");
  const providerStorage = memoryStorage(); new ProviderStore({ storage: providerStorage }).save([catalog.normalizeAliyunBailianConfig(config())]);
  const raw = Array.from(providerStorage.values.values()).join("");
  assert.match(raw, /workspace-test/); assert.doesNotMatch(raw, /secret-value|apiKey/i);
});

test("Async definition uses official Task ID, status, Poll and result paths", () => {
  const definition = bailianDefinitions.createAliyunBailianAsyncDefinition();
  assert.equal(definition.task.idPath, "output.task_id"); assert.equal(definition.status.path, "output.task_status");
  assert.equal(definition.poll.endpointTemplate, "/api/v1/tasks/{taskId}"); assert.equal(definition.result.path, "output.choices");
  assert.equal(asyncDefinitions.validateAsyncTaskDefinition(definition).valid, true);
});

test("Submit and Poll endpoints retain the same Beijing Workspace context", () => {
  const setup = providerWith([]); const submit = setup.provider.buildHttpRequest(setup.provider.definition.submit, request(), null, {});
  const task = setup.provider.createTask(fixture("bailian-submit"), request());
  const poll = setup.provider.buildHttpRequest(setup.provider.definition.poll, null, task, {});
  assert.equal(submit.url, "https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
  assert.equal(poll.url, "https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/tasks/test-task-001");
  assert.equal(poll.body, undefined);
});

test("Submit headers include Bearer, JSON and mandatory X-DashScope-Async", () => {
  const setup = providerWith([]); const http = setup.provider.buildHttpRequest(setup.provider.definition.submit, request(), null, {});
  assert.equal(http.headers.Authorization, "Bearer test-api-key");
  assert.equal(http.headers["Content-Type"], "application/json");
  assert.equal(http.headers["X-DashScope-Async"], "enable");
});

test("T2I body contains only text content and n is locked to one", () => {
  const body = builder.buildAliyunBailianRequestBody(request());
  assert.deepEqual(body.input.messages[0].content, [{ text: "一只猫" }]);
  assert.equal(body.parameters.n, 1); assert.equal(body.parameters.watermark, undefined);
});

test("I2I preserves Main then References then text with MIME data URI", () => {
  const main = image("main", "image/jpeg"), ref1 = image("r1"), ref2 = image("r2");
  const body = builder.buildAliyunBailianRequestBody(request({ modelId: "qwen-image-3.0-pro",
    imageInputs: { mainImage: main, referenceImages: [ref1, ref2] } }));
  const content = body.input.messages[0].content;
  assert.deepEqual(content.map((item) => item.image ? item.image.split(",")[0] : "text"), ["data:image/jpeg;base64", "data:image/png;base64", "data:image/png;base64", "text"]);
  assert.equal(content[3].text, "一只猫");
});

test("four input images fail before HTTP instead of being silently dropped", async () => {
  const images = [image("r1"), image("r2"), image("r3")];
  assert.throws(() => builder.buildAliyunBailianRequestBody(request({ imageInputs: { mainImage: image("main"), referenceImages: images } })),
    (error) => error.code === ErrorCodes.INPUT_IMAGE_LIMIT);
  const setup = providerWith([fixture("bailian-submit")]);
  await assert.rejects(setup.provider.generate(request({ imageInputs: { mainImage: image("main"), referenceImages: images } })),
    (error) => error.code === ErrorCodes.INPUT_IMAGE_LIMIT);
  assert.equal(setup.apiClient.calls.length, 0);
});

test("single image over 10 MB fails before HTTP", async () => {
  const oversized = image("large"); oversized.base64 = oversized.apiValue = "A".repeat(Math.ceil((10 * 1024 * 1024 + 1) * 4 / 3));
  const setup = providerWith([fixture("bailian-submit")]);
  await assert.rejects(setup.provider.generate(request({ imageInputs: { mainImage: oversized, referenceImages: [] } })),
    (error) => error.code === ErrorCodes.PAYLOAD_TOO_LARGE);
  assert.equal(setup.apiClient.calls.length, 0);
});

test("existing ImagePayloadOptimizer accepts Bailian max-dimension constraints", async () => {
  const codec = { async transform(source, profile) { return Object.assign({}, source, { width: profile.maxDimension, height: 1024, base64: "QUJD", apiValue: "QUJD", optimization: { encodeMs: 0 } }); } };
  const optimizer = new ImagePayloadOptimizer({ codec, softTargetBytes: 99999999 });
  const result = await optimizer.optimize({ mainImage: Object.assign(image("wide"), { width: 3000 }), referenceImages: [] }, { maxDimension: 2048, maxBytesPerImage: 10 * 1024 * 1024 });
  assert.equal(result.imageInputs.mainImage.width, 2048); assert.equal(result.metrics.passCount, 1);
});

test("size presets use WIDTH*HEIGHT and Auto omits size", () => {
  const fixed = builder.buildAliyunBailianRequestBody(request({ aspectRatio: "16:9", resolutionTier: "1K" }));
  assert.equal(fixed.parameters.size, "1344*768"); assert.doesNotMatch(fixed.parameters.size, /x/);
  const automatic = builder.buildAliyunBailianRequestBody(request({ resolutionTier: "auto" }));
  assert.equal(Object.prototype.hasOwnProperty.call(automatic.parameters, "size"), false);
});

test("all published Phase 9 presets pass documented area and aspect bounds", () => {
  Object.keys(catalog.ALIYUN_BAILIAN_SIZE_PRESETS).forEach((ratio) => Object.keys(catalog.ALIYUN_BAILIAN_SIZE_PRESETS[ratio]).forEach((tier) => {
    assert.equal(catalog.validateAliyunBailianPixelSize(catalog.ALIYUN_BAILIAN_SIZE_PRESETS[ratio][tier]), true);
  }));
});

test("prompt extension, thinking, negative prompt and valid seed map exactly", () => {
  const body = builder.buildAliyunBailianRequestBody(request({ negativePrompt: "模糊", seed: "2147483647" }));
  assert.equal(body.parameters.prompt_extend, true); assert.equal(body.parameters.prompt_extend_mode, "direct");
  assert.equal(body.parameters.enable_thinking, true); assert.equal(body.parameters.negative_prompt, "模糊");
  assert.equal(body.parameters.seed, 2147483647);
});

test("empty negative prompt and Seed are omitted; invalid Seed fails", () => {
  const body = builder.buildAliyunBailianRequestBody(request({ negativePrompt: "  ", seed: "" }));
  assert.equal(Object.prototype.hasOwnProperty.call(body.parameters, "negative_prompt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body.parameters, "seed"), false);
  assert.throws(() => builder.buildAliyunBailianRequestBody(request({ seed: "2147483648" })), (error) => error.code === ErrorCodes.INVALID_SEED);
});

test("agent is valid for T2I but always falls back to direct for I2I", () => {
  const t2i = builder.buildAliyunBailianRequestBody(request({ promptExtendMode: "agent" }));
  const i2i = builder.buildAliyunBailianRequestBody(request({ promptExtendMode: "agent", imageInputs: { mainImage: image("main"), referenceImages: [] } }));
  assert.equal(t2i.parameters.prompt_extend_mode, "agent"); assert.equal(i2i.parameters.prompt_extend_mode, "direct");
});

test("Task ID extraction and status mapping match Bailian fixtures", () => {
  const definition = bailianDefinitions.createAliyunBailianAsyncDefinition();
  assert.equal(asyncDefinitions.resolveAsyncPath(fixture("bailian-submit"), definition.task.idPath), "test-task-001");
  assert.equal(asyncDefinitions.classifyAsyncStatus(definition, fixture("bailian-running")).kind, "pending");
  assert.equal(asyncDefinitions.classifyAsyncStatus(definition, fixture("bailian-succeeded")).kind, "success");
  assert.equal(asyncDefinitions.classifyAsyncStatus(definition, fixture("bailian-failed")).kind, "failure");
  assert.equal(asyncDefinitions.classifyAsyncStatus(definition, fixture("bailian-canceled")).kind, "canceled");
  assert.equal(asyncDefinitions.classifyAsyncStatus(definition, fixture("bailian-unknown")).kind, "unknown");
});

test("result extractor walks every choice and every content image", () => {
  const response = fixture("bailian-succeeded");
  response.output.choices.push({ message: { content: [{ type: "text", text: "done" }, { type: "image", image: "https://example.com/result-2.png" }] } });
  assert.deepEqual(asyncDefinitions.extractAsyncResult(bailianDefinitions.createAliyunBailianAsyncDefinition(), response).urls,
    ["https://example.com/result.png", "https://example.com/result-2.png"]);
});

test("FAILED exposes code/message and CANCELED remains remote terminal cancellation", async () => {
  const failed = providerWith([fixture("bailian-submit"), fixture("bailian-failed")]);
  await assert.rejects(failed.provider.generate(request()), (error) => error.code === ErrorCodes.ASYNC_TASK_FAILED && /InvalidParameter/.test(error.message));
  const canceled = providerWith([fixture("bailian-submit"), fixture("bailian-canceled")]);
  await assert.rejects(canceled.provider.generate(request()), (error) => error.code === ErrorCodes.ASYNC_REMOTE_CANCELED);
});

test("UNKNOWN is terminal after one query and maps to readable Bailian expiry guidance", async () => {
  const setup = providerWith([fixture("bailian-submit"), fixture("bailian-unknown")]);
  await assert.rejects(setup.provider.generate(request()), (error) => {
    assert.equal(error.code, ErrorCodes.BAILIAN_TASK_UNAVAILABLE);
    const message = toUserMessage(error, createTranslator("zh-CN"));
    assert.match(message, new RegExp(zhCN.errorBailianTaskUnavailable));
    assert.match(message, /BAILIAN_TASK_UNAVAILABLE/);
    assert.match(message, /Provider：阿里云百炼/);
    assert.match(message, /Endpoint：\/api\/v1\/tasks\/\{taskId\}/);
    return true;
  });
  assert.equal(setup.apiClient.calls.filter((call) => call.method === "GET").length, 1);
});

test("missing task_id fails safely and never creates recovery metadata", async () => {
  const setup = providerWith([{ output: { task_status: "PENDING" }, request_id: "test-request" }]);
  await assert.rejects(setup.provider.submit(request()), (error) => error.code === ErrorCodes.INVALID_RESPONSE);
  assert.equal(setup.store.all().length, 0);
});

test("Recovery queries original task with GET and never performs a second Submit", async () => {
  const setup = providerWith([fixture("bailian-submit"), fixture("bailian-succeeded")]);
  const submitted = await setup.provider.submit(Object.assign(request(), { executionId: "exec-A", historyId: "history-A" }));
  const recovered = await setup.provider.recoverTask(submitted.id);
  assert.equal(asyncDefinitions.classifyAsyncStatus(setup.provider.definition, recovered).kind, "success");
  assert.deepEqual(setup.apiClient.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(setup.apiClient.calls[1].url.endsWith("/api/v1/tasks/test-task-001"), true);
  assert.equal(setup.store.load("test-task-001", "aliyun-bailian").executionId, "exec-A");
});

test("Async task persistence keeps region/workspace context and excludes API Key and Base64", async () => {
  const setup = providerWith([fixture("bailian-submit")]);
  await setup.provider.submit(Object.assign(request({ imageInputs: { mainImage: image("main"), referenceImages: [] } }), { executionId: "exec", historyId: "history" }));
  const raw = setup.storage.values.get(ASYNC_TASK_STORAGE_KEY);
  assert.match(raw, /cn-beijing|workspace-test/); assert.doesNotMatch(raw, /test-api-key|Bearer|QUJD|Authorization/);
});

test("SUCCEEDED result enters preview/import pipeline without a real network request", async () => {
  const setup = providerWith([fixture("bailian-submit"), fixture("bailian-running"), fixture("bailian-succeeded")]);
  let imported = 0, historySuccess = 0;
  const manager = new GenerationManager({
    providerManager: { requireProvider(id) { assert.equal(id, "aliyun-bailian"); return setup.provider; } },
    imageImporter: { async importImages(images) { imported += 1; assert.equal(images[0].importSource.url, "https://example.com/result.png"); return { imported: true, layerNames: ["AI_Generated_001"] }; } },
    historyStore: { beginExecution() {}, writeExecutionStatus() {}, async recordSuccess(input, result) { historySuccess += 1; assert.equal(result.providerId, "aliyun-bailian"); }, recordFailure() {} },
    t(key) { return key; }
  });
  const result = await manager.generateOneClick(Object.assign(request(), { autoImport: true }), {});
  assert.equal(result.taskId, "test-task-001"); assert.equal(result.importState, "imported");
  assert.equal(imported, 1); assert.equal(historySuccess, 1);
});

function memoryFs() {
  const files = new Map();
  return { files, makedir() { return { err: 0 }; }, stat(target) { return files.has(target) ? { err: 0 } : { err: 1 }; },
    readFile(target) { return files.has(target) ? { err: 0, data: files.get(target) } : { err: 1 }; },
    writeFile(target, data) { files.set(target, data); return { err: 0 }; }, deleteFile(target) { files.delete(target); return { err: 0 }; } };
}

test("Bailian temporary result URL is downloaded into local History storage", async () => {
  const png = fs.readFileSync(path.resolve(__dirname, "../client/assets/mock-result.png"));
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
  const cepFs = memoryFs(); let downloads = 0;
  const history = new HistoryStore({ rootPath: "C:\\UserData", cepFs, base64Encoding: "base64",
    apiClient: { async requestArrayBuffer(url) { downloads += 1; assert.equal(url, "https://example.com/result.png"); return { bytes: buffer }; } },
    photoshopBridge: { resolveExtensionAsset(value) { return value; } } });
  const identity = { executionId: "exec-history", historyId: "history-bailian", taskId: "test-task-001" };
  history.beginExecution(Object.assign(request(), { providerDisplayName: "阿里云百炼", modelDisplayName: "Qwen Image 3.0", providerMetadata: { region: "cn-beijing", workspaceId: "workspace-test" } }), identity);
  const entry = await history.recordSuccess(Object.assign(request(), { providerDisplayName: "阿里云百炼", modelDisplayName: "Qwen Image 3.0", providerMetadata: { region: "cn-beijing", workspaceId: "workspace-test" } }), {
    providerId: "aliyun-bailian", modelId: "qwen-image-3.0", taskId: "test-task-001", importState: "notImported",
    images: [{ importSource: { type: "url", url: "https://example.com/result.png" } }]
  }, identity);
  assert.equal(downloads, 1); assert.ok(entry.localResultFile); assert.equal(cepFs.files.has(entry.localResultFile), true);
  assert.equal(entry.providerDisplayName, "阿里云百炼"); assert.equal(entry.region, "cn-beijing"); assert.equal(entry.workspaceId, "workspace-test");
  assert.equal(JSON.stringify(entry).includes("test-api-key"), false);
});

test("Settings and Generate UI expose Bailian fields and safe configuration-only connection test", () => {
  const settings = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  const main = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(settings, /id="aliyun-region"/); assert.match(settings, /id="aliyun-workspace-id"/); assert.match(settings, /this\.testButton\.hidden = false/);
  assert.match(settings, /configValidationPassedNoFreeEndpoint/);
  assert.match(main, /id="negative-prompt"/); assert.match(main, /id="prompt-extend"/); assert.match(main, /id="enable-thinking"/); assert.match(main, /id="seed"/);
});

test("Generic Async Core contains no Aliyun, Bailian or Qwen provider-name branch", () => {
  ["asyncTaskDefinition.js", "asyncTaskProvider.js"].forEach((name) => {
    const source = fs.readFileSync(path.resolve(__dirname, "../client/js/providers/" + name), "utf8");
    assert.doesNotMatch(source, /aliyun|bailian|qwen/i);
  });
  const polling = fs.readFileSync(path.resolve(__dirname, "../client/js/generation/pollingManager.js"), "utf8");
  assert.doesNotMatch(polling, /aliyun|bailian|qwen/i);
});

test("Phase 9 tests and fixtures never authorize an unmocked paid Bailian call", async () => {
  const guard = createNetworkSafetyGuard([]);
  await assert.rejects(guard.requestJson("https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation", { method: "POST" }),
    (error) => error.code === "NETWORK_CALL_NOT_ALLOWED_IN_TEST");
});
