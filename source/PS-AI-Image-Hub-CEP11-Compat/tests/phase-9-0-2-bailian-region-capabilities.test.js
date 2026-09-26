"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { AsyncTaskStore } = require("../client/js/storage/asyncTaskStore");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const { createTranslator } = require("../client/js/i18n");
const { SettingsPanel } = require("../client/js/ui/settingsPanel");

const ALL_REGIONS = ["cn-beijing", "ap-southeast-1", "eu-central-1", "ap-northeast-1", "cn-hongkong"];
const QWEN_REGIONS = ["cn-beijing", "ap-southeast-1"];

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}

function createSetup(responses, config) {
  const queue = (responses || []).slice();
  const calls = [];
  const taskStore = new AsyncTaskStore({ storage: memoryStorage() });
  const provider = new AliyunBailianProvider(Object.assign({ region: "cn-beijing", workspaceId: "workspace-current", modelId: "qwen-image-3.0" }, config || {}), {
    apiClient: { async requestJson(url, options) {
      calls.push({ url, method: options.method });
      if (!queue.length) throw new Error("NETWORK_CALL_NOT_ALLOWED_IN_TEST");
      return queue.shift();
    } },
    secretStore: { get() { return "test-api-key"; } },
    asyncTaskStore: taskStore,
    pollingManager: new PollingManager({ wait: () => Promise.resolve() })
  });
  return { provider, taskStore, calls };
}

function request(region, modelId) {
  return {
    providerId: "aliyun-bailian", modelId: modelId || "qwen-image-3.0", prompt: "region capability fixture",
    aspectRatio: "1:1", resolutionTier: "1K", imageInputs: { mainImage: null, referenceImages: [] },
    promptExtend: true, promptExtendMode: "direct", enableThinking: true,
    providerMetadata: { region, workspaceId: "workspace-request" }
  };
}

test("Qwen Image 3.0 declares only Beijing and Singapore", () => {
  assert.deepEqual(catalog.getAliyunBailianModel("qwen-image-3.0").supportedRegions, QWEN_REGIONS);
});

test("Qwen Image 3.0 Pro declares only Beijing and Singapore", () => {
  assert.deepEqual(catalog.getAliyunBailianModel("qwen-image-3.0-pro").supportedRegions, QWEN_REGIONS);
});

test("platform Region Catalog retains all five Phase 9.0.1 regions", () => {
  assert.deepEqual(catalog.ALIYUN_BAILIAN_REGION_CATALOG.map((region) => region.id), ALL_REGIONS);
});

test("capability-driven Qwen Region options contain only Beijing and Singapore", () => {
  assert.deepEqual(catalog.getAliyunBailianSupportedRegions("qwen-image-3.0").map((region) => region.label), ["北京", "新加坡"]);
  assert.deepEqual(catalog.getAliyunBailianSupportedRegions("qwen-image-3.0-pro").map((region) => region.id), QWEN_REGIONS);
});

test("Settings Region UI filters options and reports an automatic fallback", () => {
  const previousDocument = global.document;
  const previousRefresh = global.PSAIImageHubCompat.refreshEnhancedSelect;
  const regionSelect = {
    value: "cn-hongkong", options: [],
    set innerHTML(value) { this.options = []; this.value = ""; },
    get innerHTML() { return ""; },
    appendChild(option) { this.options.push(option); if (!this.value) this.value = option.value; }
  };
  const fields = {
    "aliyun-model": { value: "qwen-image-3.0" },
    "aliyun-region": regionSelect,
    "aliyun-workspace-id": { value: "workspace-ui" },
    "aliyun-info-endpoint": { textContent: "" }
  };
  const panel = Object.create(SettingsPanel.prototype);
  panel.field = (id) => fields[id];
  panel.message = { textContent: "", className: "" };
  panel.t = createTranslator("zh-CN");
  try {
    global.document = { createElement() { return { value: "", textContent: "" }; } };
    global.PSAIImageHubCompat.refreshEnhancedSelect = function noop() {};
    panel.syncAliyunFields({ notifyFallback: true, preferredRegion: "cn-hongkong" });
    assert.deepEqual(regionSelect.options.map((option) => [option.value, option.textContent]), [
      ["cn-beijing", "北京"], ["ap-southeast-1", "新加坡"]
    ]);
    assert.equal(regionSelect.value, "cn-beijing");
    assert.equal(panel.message.textContent, "当前模型不支持原地域，已切换为北京。");
  } finally {
    global.document = previousDocument;
    global.PSAIImageHubCompat.refreshEnhancedSelect = previousRefresh;
  }
});

test("legacy Frankfurt config falls back to the model first supported Region", () => {
  const normalized = catalog.normalizeAliyunBailianConfig({ modelId: "qwen-image-3.0", region: "eu-central-1", workspaceId: "workspace-old" });
  assert.equal(normalized.region, "cn-beijing");
});

test("legacy config without Region still falls back to Beijing", () => {
  assert.equal(catalog.normalizeAliyunBailianConfig({ modelId: "qwen-image-3.0", workspaceId: "workspace-old" }).region, "cn-beijing");
});

test("model update revalidates an incompatible Region and falls back to the first supported Region", () => {
  const setup = createSetup([]);
  setup.provider.config.region = "cn-hongkong";
  setup.provider.updateConfig(Object.assign({}, setup.provider.config, { modelId: "qwen-image-3.0-pro" }));
  assert.equal(setup.provider.config.region, "cn-beijing");
});

test("unsupported Qwen Submit fails before HTTP with a readable Chinese message", async () => {
  const setup = createSetup([{ output: { task_status: "PENDING", task_id: "must-not-submit" } }]);
  await assert.rejects(setup.provider.submit(request("cn-hongkong")), (error) => {
    assert.equal(error.code, ErrorCodes.BAILIAN_REGION_UNSUPPORTED);
    assert.equal(toUserMessage(error, createTranslator("zh-CN")), "Qwen Image 3.0 当前不支持所选地域，请选择北京或新加坡。");
    return true;
  });
  assert.equal(setup.calls.length, 0);
});

test("Qwen Image Submit accepts Beijing", async () => {
  const setup = createSetup([{ output: { task_status: "PENDING", task_id: "task-beijing" } }]);
  await setup.provider.submit(request("cn-beijing"));
  assert.equal(setup.calls[0].url, catalog.buildBailianSubmitUrl("workspace-request", "cn-beijing"));
});

test("Qwen Image Submit accepts Singapore", async () => {
  const setup = createSetup([{ output: { task_status: "PENDING", task_id: "task-singapore" } }]);
  await setup.provider.submit(request("ap-southeast-1"));
  assert.equal(setup.calls[0].url, catalog.buildBailianSubmitUrl("workspace-request", "ap-southeast-1"));
});

test("Recovery preserves a historical Hong Kong task Region and performs no Submit", async () => {
  const setup = createSetup([{ output: { task_status: "SUCCEEDED", task_id: "task-history-hk", choices: [{ message: { content: [{ image: "https://example.com/history-hk.png" }] } }] } }]);
  const historicalRequest = Object.assign(request("cn-hongkong"), { executionId: "exec-hk", historyId: "history-hk" });
  const historicalTask = setup.provider.createTask({ output: { task_status: "PENDING", task_id: "task-history-hk" } }, historicalRequest);
  setup.taskStore.save(historicalTask);
  setup.provider.updateConfig({ region: "cn-beijing", workspaceId: "workspace-current", modelId: "qwen-image-3.0" });
  await setup.provider.recoverTask("task-history-hk", {});
  assert.deepEqual(setup.calls.map((call) => call.method), ["GET"]);
  assert.equal(setup.calls[0].url, catalog.buildBailianPollUrl("workspace-request", "cn-hongkong", "task-history-hk"));
  assert.equal(setup.taskStore.load("task-history-hk", "aliyun-bailian", setup.provider.definition.id).requestConfiguration.region, "cn-hongkong");
});

test("History keeps the task's original Region even when current UI capabilities differ", () => {
  const entry = HistoryStore.prototype.baseEntry.call({}, {
    providerId: "aliyun-bailian", modelId: "qwen-image-3.0",
    providerMetadata: { region: "ap-northeast-1", workspaceId: "workspace-history" }
  }, {}, "succeeded", { executionId: "exec-history", historyId: "history-original", taskId: "task-original" });
  assert.equal(entry.region, "ap-northeast-1");
});

test("Settings uses model capability helpers and Generic Async Core remains provider-neutral", () => {
  const settings = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  assert.match(settings, /getAliyunBailianSupportedRegions/);
  assert.match(settings, /resolveAliyunBailianSupportedRegion/);
  assert.match(settings, /aliyunRegionFallback/);
  ["asyncTaskProvider.js", "asyncTaskDefinition.js"].forEach((name) => {
    const source = fs.readFileSync(path.resolve(__dirname, "../client/js/providers", name), "utf8");
    assert.doesNotMatch(source, /aliyun|bailian|qwen/i);
  });
});
