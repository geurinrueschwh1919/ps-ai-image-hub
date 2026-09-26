"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { AsyncTaskStore } = require("../client/js/storage/asyncTaskStore");
const { ProviderStore } = require("../client/js/storage/providerStore");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const { createTranslator } = require("../client/js/i18n");

const REGIONS = ["cn-beijing", "ap-southeast-1", "eu-central-1", "ap-northeast-1", "cn-hongkong"];
const SUBMIT_PATH = "/api/v1/services/aigc/image-generation/generation";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function queuedApi(responses) {
  const queue = (responses || []).slice();
  const calls = [];
  return {
    calls,
    async requestJson(url, options) {
      calls.push({ url, method: options.method, diagnostics: options.diagnostics });
      if (!queue.length) throw new Error("NETWORK_CALL_NOT_ALLOWED_IN_TEST");
      return queue.shift();
    }
  };
}

function request(region, workspaceId) {
  return {
    providerId: "aliyun-bailian",
    modelId: "qwen-image-3.0",
    prompt: "region fixture",
    aspectRatio: "1:1",
    resolutionTier: "1K",
    imageInputs: { mainImage: null, referenceImages: [] },
    promptExtend: true,
    promptExtendMode: "direct",
    enableThinking: true,
    providerMetadata: { region, workspaceId }
  };
}

function createProvider(region, responses, storage) {
  const apiClient = queuedApi(responses);
  const taskStorage = storage || memoryStorage();
  const taskStore = new AsyncTaskStore({ storage: taskStorage });
  const provider = new AliyunBailianProvider({
    region,
    workspaceId: "workspace-original",
    modelId: "qwen-image-3.0"
  }, {
    apiClient,
    secretStore: { get() { return "fixture-api-key"; } },
    asyncTaskStore: taskStore,
    pollingManager: new PollingManager({ wait: () => Promise.resolve() })
  });
  return { provider, apiClient, taskStore, taskStorage };
}

test("Phase 9.0.1 region catalog contains exactly the five requested regions", () => {
  assert.deepEqual(catalog.ALIYUN_BAILIAN_REGION_CATALOG.map((item) => item.id), REGIONS);
  assert.deepEqual(catalog.ALIYUN_BAILIAN_REGION_CATALOG.map((item) => item.label), ["北京", "新加坡", "法兰克福", "东京", "中国香港"]);
});

test("legacy Bailian config without region defaults to cn-beijing while explicit empty region stays invalid", () => {
  assert.equal(catalog.normalizeAliyunBailianConfig({ workspaceId: "workspace-old" }).region, "cn-beijing");
  assert.equal(catalog.normalizeAliyunBailianConfig({ workspaceId: "workspace-old", region: "" }).region, "");
});

test("Provider Store persists selected region and Workspace without API Key", () => {
  const storage = memoryStorage();
  const store = new ProviderStore({ storage });
  store.save([catalog.normalizeAliyunBailianConfig({ region: "ap-southeast-1", workspaceId: "workspace-sg" })]);
  const loaded = store.load()[0];
  assert.equal(loaded.region, "ap-southeast-1");
  assert.equal(loaded.workspaceId, "workspace-sg");
  assert.doesNotMatch(Array.from(storage.values.values()).join(""), /fixture-api-key|apiKey/i);
});

test("Submit and Poll URL builders cover every Phase 9.0.1 region", () => {
  REGIONS.forEach((region) => {
    assert.equal(catalog.buildBailianSubmitUrl("workspace-test", region), `https://workspace-test.${region}.maas.aliyuncs.com${SUBMIT_PATH}`);
    assert.equal(catalog.buildBailianPollUrl("workspace-test", region, "task/one"), `https://workspace-test.${region}.maas.aliyuncs.com/api/v1/tasks/task%2Fone`);
  });
});

test("Submit and Poll use the same selected region, Workspace and safe diagnostics", () => {
  REGIONS.forEach((region) => {
    const setup = createProvider(region, []);
    const generationRequest = request(region, "workspace-original");
    const submit = setup.provider.buildHttpRequest(setup.provider.definition.submit, generationRequest, null, {});
    const task = setup.provider.createTask({ output: { task_status: "PENDING", task_id: "task-1" } }, generationRequest);
    const poll = setup.provider.buildHttpRequest(setup.provider.definition.poll, null, task, {});
    assert.equal(submit.url, catalog.buildBailianSubmitUrl("workspace-original", region));
    assert.equal(poll.url, catalog.buildBailianPollUrl("workspace-original", region, "task-1"));
    assert.equal(task.requestConfiguration.region, region);
    assert.equal(task.requestConfiguration.workspaceId, "workspace-original");
    assert.equal(submit.diagnostics.region, region);
    assert.equal(submit.headers.Authorization, poll.headers.Authorization);
    assert.doesNotMatch(JSON.stringify(submit.diagnostics), /fixture-api-key|Authorization|base64/i);
    assert.doesNotMatch(submit.diagnostics.submitEndpoint, /workspace-original/);
    assert.doesNotMatch(poll.diagnostics.pollEndpoint, /workspace-original/);
  });
});

test("Task Store persists a supported region and reads it after a simulated panel restart", async () => {
  const storage = memoryStorage();
  const setup = createProvider("ap-southeast-1", [{ output: { task_status: "PENDING", task_id: "task-sg-store" } }], storage);
  await setup.provider.submit(request("ap-southeast-1", "workspace-sg-store"), {});
  const restartedStore = new AsyncTaskStore({ storage });
  const saved = restartedStore.load("task-sg-store", "aliyun-bailian", setup.provider.definition.id);
  assert.equal(saved.requestConfiguration.region, "ap-southeast-1");
  assert.equal(saved.requestConfiguration.workspaceId, "workspace-sg-store");
  assert.equal(saved.pollUrl, catalog.buildBailianPollUrl("workspace-sg-store", "ap-southeast-1", "task-sg-store"));
});

test("Recovery uses the original saved region after current settings change and never submits twice", async () => {
  const storage = memoryStorage();
  const setup = createProvider("ap-southeast-1", [
    { output: { task_status: "PENDING", task_id: "task-sg" } },
    { output: { task_id: "task-sg", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: "https://example.com/sg.png" }] } }] } }
  ], storage);
  await setup.provider.submit(request("ap-southeast-1", "workspace-sg"), {});
  setup.provider.updateConfig({ region: "eu-central-1", workspaceId: "workspace-eu", modelId: "qwen-image-3.0" });
  await setup.provider.recoverTask("task-sg", {});
  assert.equal(setup.apiClient.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(setup.apiClient.calls.filter((call) => call.method === "GET").length, 1);
  assert.equal(setup.apiClient.calls[1].url, catalog.buildBailianPollUrl("workspace-sg", "ap-southeast-1", "task-sg"));
});

test("Recovery success writes the original task Region and Workspace back to History", async () => {
  const setup = createProvider("ap-southeast-1", [
    { output: { task_status: "PENDING", task_id: "task-history-sg" } },
    { output: { task_id: "task-history-sg", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: "https://example.com/history-sg.png" }] } }] } }
  ]);
  const original = Object.assign(request("ap-southeast-1", "workspace-history-sg"), {
    executionId: "exec-history-sg", historyId: "history-sg"
  });
  await setup.provider.submit(original, {});
  setup.provider.updateConfig({ region: "eu-central-1", workspaceId: "workspace-current-eu", modelId: "qwen-image-3.0" });
  const captured = [];
  const manager = new GenerationManager({
    providerManager: { requireProvider() { return setup.provider; } },
    responseExtractor: { async extract() { return { images: [{ id: "result-history-sg" }] }; } },
    historyStore: {
      beginExecution(input) { captured.push({ stage: "begin", metadata: input.providerMetadata }); },
      async recordSuccess(input) { captured.push({ stage: "success", metadata: input.providerMetadata }); }
    },
    t(key) { return key; }
  });
  await manager.recoverProviderTask("aliyun-bailian", "task-history-sg", { modelId: "qwen-image-3.0", prompt: "recover", autoImport: false });
  assert.deepEqual(captured.map((item) => item.metadata.region), ["ap-southeast-1", "ap-southeast-1"]);
  assert.deepEqual(captured.map((item) => item.metadata.workspaceId), ["workspace-history-sg", "workspace-history-sg"]);
  assert.equal(setup.apiClient.calls.filter((call) => call.method === "POST").length, 1);
});

test("History entry preserves the original region and Workspace identity", () => {
  const entry = HistoryStore.prototype.baseEntry.call({}, {
    providerId: "aliyun-bailian",
    modelId: "qwen-image-3.0-pro",
    providerMetadata: { region: "ap-northeast-1", workspaceId: "workspace-tokyo" }
  }, { taskId: "task-tokyo" }, "submitting", {
    executionId: "exec-tokyo", historyId: "history-tokyo", taskId: "task-tokyo"
  });
  assert.equal(entry.region, "ap-northeast-1");
  assert.equal(entry.workspaceId, "workspace-tokyo");
  assert.equal(entry.taskId, "task-tokyo");
});

test("missing Region, Workspace and API Key expose specific Chinese errors", () => {
  const cases = [
    [{ region: "", workspaceId: "workspace-test" }, "fixture-api-key", ErrorCodes.BAILIAN_REGION_REQUIRED, "阿里云百炼缺少地域。"],
    [{ region: "cn-beijing", workspaceId: "" }, "fixture-api-key", ErrorCodes.BAILIAN_WORKSPACE_REQUIRED, "阿里云百炼缺少 Workspace ID。"],
    [{ region: "cn-beijing", workspaceId: "workspace-test" }, "", ErrorCodes.BAILIAN_API_KEY_REQUIRED, "阿里云百炼缺少 API Key。"]
  ];
  cases.forEach(([config, apiKey, code, message]) => {
    const setup = createProvider(config.region, []);
    setup.provider.updateConfig(Object.assign({ modelId: "qwen-image-3.0" }, config));
    setup.provider.secretStore = { get() { return apiKey; } };
    const validation = setup.provider.validateConfig();
    assert.equal(validation.code, code);
    assert.equal(toUserMessage({ code }, createTranslator("zh-CN")), message);
  });
});

test("Settings renders a capability-driven Region field without changing Generic Async Core", () => {
  const settings = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  const core = ["asyncTaskProvider.js", "asyncTaskDefinition.js"].map((name) =>
    fs.readFileSync(path.resolve(__dirname, "../client/js/providers", name), "utf8")).join("\n");
  assert.match(settings, /helpAliyunRegion/);
  assert.match(settings, /getAliyunBailianSupportedRegions/);
  assert.match(settings, /id="aliyun-region"/);
  assert.match(settings, /Async Task API/);
  assert.match(settings, /this\.t\("defaultModel"\)/);
  assert.match(settings, />Region<\/small>/);
  assert.doesNotMatch(core, /aliyun|bailian|qwen/i);
});
