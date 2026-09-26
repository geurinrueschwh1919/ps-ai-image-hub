"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { GrsProvider } = require("../client/js/providers/grsProvider");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { ProviderManager } = require("../client/js/ui/providerManager");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { buildGenerationRequest } = require("../client/js/generation/requestBuilder");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { GenerationRecoveryStore } = require("../client/js/storage/generationRecoveryStore");
const { AsyncTaskStore } = require("../client/js/storage/asyncTaskStore");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { getProviderOptionVisibility } = require("../client/js/ui/mainPanel");
const bailianCatalog = require("../client/js/providers/aliyunBailianCatalog");

const root = path.resolve(__dirname, "..");
function source(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
const indexSource = source("client/index.html");
const appSource = source("client/js/app.js");
const mainSource = source("client/js/ui/mainPanel.js");
const settingsSource = source("client/js/ui/settingsPanel.js");
const historySource = source("client/js/ui/historyPanel.js");
const managerSource = source("client/js/generation/generationManager.js");
const recoverySource = source("client/js/storage/generationRecoveryStore.js");
const cssSource = source("client/css/main.css");

function managerSetup() {
  const registry = new ProviderRegistry();
  const provider = new MockProvider({ submitDelay: 0, generationDelay: 0 });
  let submits = 0;
  let lastRequest = null;
  const generate = provider.generate.bind(provider);
  provider.generate = async function counted(request, context) {
    submits += 1; lastRequest = request; return generate(request, context);
  };
  registry.register(provider);
  const manager = new GenerationManager({
    providerManager: new ProviderManager(registry),
    imageImporter: { async importImages() { return { imported: true, layerNames: ["AI_Generated_001"] }; } },
    t(key) { return key; }
  });
  return { manager, provider, submits: () => submits, request: () => lastRequest };
}

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}

test("Generate UI has no Prompt Optimizer controls or preview", () => {
  assert.doesNotMatch(mainSource, /optimize-prompt|auto-optimize|prompt-optimization|optimization-before|optimization-after/);
});

test("Settings UI has no Text Provider configuration", () => {
  assert.doesNotMatch(settingsSource, /text-provider|textProvider|promptOptimizer|Text API|Text Model/);
});

test("runtime index loads no prompt or text modules", () => {
  assert.doesNotMatch(indexSource, /js\/(?:prompt|text)\//);
  assert.doesNotMatch(indexSource, /promptOptimizerStore/);
});

test("removed Prompt Optimizer runtime files are absent", () => {
  assert.equal(fs.existsSync(path.join(root, "client/js/prompt/promptOptimizer.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/js/text/textProviderManager.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/js/storage/promptOptimizerStore.js")), false);
});

test("app bootstrap does not read legacy text-provider API Key names", () => {
  assert.doesNotMatch(appSource, /text-provider:|TextProvider|promptOptimizer/);
  assert.match(appSource, /provider:grs:apiKey/);
});

test("GenerationManager does not reference or trigger optimization runtime", () => {
  assert.doesNotMatch(managerSource, /promptOptimizer|autoOptimize|optimizingPrompt|textProvider|optimizedPrompt/);
});

test("one click sends the exact trimmed Prompt to one Image Provider Submit", async () => {
  const setup = managerSetup();
  const result = await setup.manager.generateOneClick({ providerId: "mock", modelId: "mock-image-v1", prompt: "  最终图像提示词  " });
  assert.equal(setup.submits(), 1);
  assert.equal(setup.request().prompt, "最终图像提示词");
  assert.equal(setup.request().finalPrompt, "最终图像提示词");
  assert.equal(result.prompt, "最终图像提示词");
});

test("image request contains no Prompt Optimizer metadata", () => {
  const request = buildGenerationRequest({ providerId: "mock", modelId: "mock-image-v1", prompt: "图像提示词" });
  ["userPrompt", "optimizedPrompt", "promptOptimizationUsed", "promptOptimizationMode", "textProviderId", "textModelId"].forEach((name) => {
    assert.equal(Object.prototype.hasOwnProperty.call(request, name), false);
  });
});

test("Mock image generation remains operational", async () => {
  const setup = managerSetup();
  const result = await setup.manager.generateOneClick({ providerId: "mock", modelId: "mock-image-v1", prompt: "Mock 检查" });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].importSource.relativePath, "client/assets/mock-result.png");
});

test("Bailian image catalog and request capabilities remain present", () => {
  assert.deepEqual(bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG.map((model) => model.id), ["qwen-image-3.0", "qwen-image-3.0-pro"]);
  assert.equal(bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG[0].supportsPromptExtend, true);
  assert.equal(bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG[0].supportsThinking, true);
});

test("GRS image generation succeeds from a mocked Image API response", async () => {
  let calls = 0;
  const provider = new GrsProvider(null, {
    secretStore: { get() { return "unit-test-key"; } },
    apiClient: { async requestJson() { calls += 1; return { id: "grs-task", status: "succeeded", results: [{ url: "https://example.com/grs.png" }] }; } }
  });
  const response = await provider.generate({ providerId: "grs", modelId: "nano-banana-2", prompt: "GRS 图像", aspectRatio: "1:1", imageSize: "1K" });
  assert.equal(calls, 1);
  assert.equal(provider.extractImages(provider.parseResponse(response))[0].importSource.url, "https://example.com/grs.png");
});

test("Bailian Image generation completes through mocked Submit and Poll", async () => {
  const responses = [
    { output: { task_status: "PENDING", task_id: "bailian-task" }, request_id: "submit" },
    { output: { task_status: "SUCCEEDED", task_id: "bailian-task", choices: [{ message: { content: [{ image: "https://example.com/bailian.png", type: "image" }] } }] }, request_id: "poll" }
  ];
  let calls = 0;
  const provider = new AliyunBailianProvider({ region: "cn-beijing", workspaceId: "workspace-test", modelId: "qwen-image-3.0" }, {
    secretStore: { get() { return "unit-test-key"; } },
    apiClient: { async requestJson() { calls += 1; return responses.shift(); } },
    asyncTaskStore: new AsyncTaskStore({ storage: memoryStorage() }),
    pollingManager: new PollingManager({ wait() { return Promise.resolve(); } })
  });
  const response = await provider.generate({ providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "百炼图像",
    aspectRatio: "1:1", resolutionTier: "1K", count: 1, imageInputs: { mainImage: null, referenceImages: [] },
    negativePrompt: "", promptExtend: true, promptExtendMode: "direct", enableThinking: true, seed: "" });
  const parsed = provider.parseResponse(response);
  assert.equal(calls, 2);
  assert.equal(provider.extractImages(parsed)[0].importSource.url, "https://example.com/bailian.png");
});

test("new recovery snapshots write only final image Prompt fields", () => {
  let metadata = null;
  const cepFs = {
    makedir() { return { err: 0 }; },
    readdir() { return { err: 1, data: [] }; },
    writeFile(file, data) { if (/metadata\.json$/.test(file)) metadata = JSON.parse(data); return { err: 0 }; },
    stat() { return { err: 0 }; }
  };
  const store = new GenerationRecoveryStore({ cepFs, rootPath: "C:\\unit\\recovery" });
  store.saveSnapshot("task-1", { providerId: "mock", modelId: "mock-image-v1", prompt: "最终提示词", imageInputs: { mainImage: null, referenceImages: [] } });
  assert.equal(metadata.prompt, "最终提示词");
  assert.equal(metadata.finalPrompt, "最终提示词");
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, "optimizedPrompt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, "textProviderId"), false);
});

test("old History JSON remains readable and preserves legacy fields", () => {
  const legacy = [{ id: "old", prompt: "旧提示", finalPrompt: "旧最终提示", optimizedPrompt: "旧优化提示", promptOptimizationUsed: true }];
  const store = new HistoryStore({ rootPath: "C:\\unit", cepFs: { readFile() { return { err: 0, data: JSON.stringify(legacy) }; } } });
  const loaded = store.load();
  assert.equal(loaded[0].finalPrompt, "旧最终提示");
  assert.equal(loaded[0].optimizedPrompt, "旧优化提示");
});

test("History display and copy prefer finalPrompt then prompt", () => {
  assert.match(historySource, /var finalPrompt = entry\.finalPrompt \|\| entry\.prompt \|\| ""/);
  assert.match(historySource, /copyText\(finalPrompt\)/);
  assert.doesNotMatch(historySource, /promptOptimizationUsed|optimizedPrompt|textProvider/);
});

test("History restore uses finalPrompt without automatic Submit", () => {
  assert.match(mainSource, /this\.promptInput\.value = entry\.finalPrompt \|\| entry\.prompt \|\| ""/);
  const restoreBody = mainSource.slice(mainSource.lastIndexOf("restoreHistoryEntry(entry)"), mainSource.indexOf("async refreshHostInfo()"));
  assert.doesNotMatch(restoreBody, /generateOneClick|\.generate\(/);
});

test("Recovery polls the original task and never invokes Image Submit", async () => {
  let submits = 0; let recoveries = 0;
  const provider = {
    id: "unit-recovery", displayName: "Unit", config: { modelId: "image-model" },
    getModels() { return [{ id: "image-model", displayName: "Image" }]; },
    getModel() { return { id: "image-model", displayName: "Image" }; },
    parseResponse(value) { return value; },
    extractImages(value) { return value.images; },
    async generate() { submits += 1; throw new Error("must not submit"); },
    async recoverTask(taskId) { recoveries += 1; return { providerId: this.id, modelId: "image-model", taskId,
      images: [{ id: "recovered", mimeType: "image/png", previewSource: "assets/mock-result.png",
        importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" } }] }; }
  };
  const registry = new ProviderRegistry(); registry.register(provider);
  const manager = new GenerationManager({ providerManager: new ProviderManager(registry), imageImporter: {}, t(key) { return key; } });
  await manager.recoverProviderTask(provider.id, "original-task", { modelId: "image-model", prompt: "旧提示" });
  assert.equal(recoveries, 1); assert.equal(submits, 0);
});

test("new History and Recovery runtime no longer writes optimizer metadata", () => {
  assert.doesNotMatch(source("client/js/storage/historyStore.js"), /userPrompt|optimizedPrompt|promptOptimizationUsed|textProviderId/);
  assert.doesNotMatch(recoverySource, /userPrompt|optimizedPrompt|promptOptimizationUsed|textProviderId/);
});

test("Mock capability state hides every Bailian-only control and notice", () => {
  const state = getProviderOptionVisibility({ id: "mock" }, { id: "mock-image-v1" });
  assert.equal(state.supportsPromptExtend, false);
  assert.equal(state.supportsThinking, false);
  assert.equal(state.temporaryResultUrls, false);
  assert.equal(state.showsBillingNotice, false);
});

test("Bailian capability state shows documented controls and notices", () => {
  const model = bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG[0];
  const state = getProviderOptionVisibility({ id: "aliyun-bailian" }, model);
  assert.equal(state.supportsPromptExtend, true);
  assert.equal(state.supportsThinking, true);
  assert.equal(state.temporaryResultUrls, true);
  assert.equal(state.showsBillingNotice, true);
});

test("Bailian to Mock transition clears stale provider-only visibility", () => {
  const bailian = getProviderOptionVisibility({ id: "aliyun-bailian" }, bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG[0]);
  const mock = getProviderOptionVisibility({ id: "mock" }, { id: "mock-image-v1" });
  assert.equal(bailian.supportsPromptExtend, true);
  assert.deepEqual(mock, { supportsNegative: false, supportsPromptExtend: false, supportsThinking: false,
    supportsSeed: false, temporaryResultUrls: false, showsBillingNotice: false });
});

test("Mock to Bailian transition restores provider-only visibility", () => {
  getProviderOptionVisibility({ id: "mock" }, { id: "mock-image-v1" });
  const state = getProviderOptionVisibility({ id: "aliyun-bailian" }, bailianCatalog.ALIYUN_BAILIAN_MODEL_CATALOG[1]);
  assert.equal(state.supportsPromptExtend && state.supportsThinking && state.temporaryResultUrls && state.showsBillingNotice, true);
});

test("Prompt Optimizer CSS and live i18n labels are removed", () => {
  assert.doesNotMatch(cssSource, /prompt-optimization|prompt-optimizer/);
  assert.doesNotMatch(source("client/js/i18n/zh-CN.js"), /optimizePrompt:|promptOptimizerSettings:|textApiService:/);
  assert.doesNotMatch(source("client/js/i18n/en-US.js"), /optimizePrompt:|promptOptimizerSettings:|textApiService:/);
});
