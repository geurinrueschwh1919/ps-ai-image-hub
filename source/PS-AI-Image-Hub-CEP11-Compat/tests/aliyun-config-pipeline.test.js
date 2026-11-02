"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { ProviderManager, KEY_UPDATED, KEY_UNCHANGED } = require("../client/js/ui/providerManager");
const { ProviderStore } = require("../client/js/storage/providerStore");
const { SettingsPanel } = require("../client/js/ui/settingsPanel");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const definitions = require("../client/js/providers/aliyunBailianDefinition");
const { ErrorCodes } = require("../client/js/utils/errors");

function memoryStorage(seed) {
  let value = seed || null;
  return { writes: 0, getItem() { return value; }, setItem(key, next) { value = next; this.writes += 1; }, value() { return value; } };
}
function secretStore() {
  const values = { "provider:aliyun-bailian:apiKey": "fixture-key-never-sent" };
  return { get(key) { return values[key] || null; }, set(key, value) { values[key] = value; }, remove(key) { delete values[key]; },
    forget() {}, isRemembered() { return false; } };
}
function apiClient() { return { requestJson() { throw new Error("No real network is allowed in this fixture."); } }; }
function makeRuntime(seed) {
  const storage = memoryStorage(seed);
  const store = new ProviderStore({ storage });
  const secrets = secretStore();
  const registry = new ProviderRegistry();
  const builtIn = new AliyunBailianProvider({}, { secretStore: secrets, apiClient: apiClient() });
  registry.register(builtIn);
  const factory = { create(config) { return new AliyunBailianProvider(config, { secretStore: secrets, apiClient: apiClient() }); } };
  const manager = new ProviderManager(registry, { providerStore: store, secretStore: secrets, providerFactory: factory });
  manager.loadConfiguredProviders();
  return { storage, store, secrets, registry, builtIn, manager, factory };
}
function uiConfig(mode, region, workspaceId) {
  const values = { "aliyun-endpoint-mode": mode, "aliyun-region": region, "aliyun-dedicated-api-host": workspaceId,
    "aliyun-model": "qwen-image-3.0" };
  return SettingsPanel.prototype.collectAliyunConfig.call({ field(id) { return { value: values[id] }; } });
}
function save(runtime, mode, region, workspaceId) {
  return runtime.manager.saveProviderConfig(uiConfig(mode, region, workspaceId), "", { keyAction: KEY_UNCHANGED });
}
function request(provider, task) {
  const input = { providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "fixture",
    aspectRatio: "1:1", resolutionTier: "1K", providerMetadata: provider.getHistoryMetadata(),
    imageInputs: { mainImage: null, referenceImages: [] } };
  return provider.buildHttpRequest(task ? provider.definition.poll : provider.definition.submit, input, task || null, {});
}

for (const item of [
  ["Beijing workspace", "dedicated", "cn-beijing", "https://llm-beijing-fixture.cn-beijing.maas.aliyuncs.com", "https://llm-beijing-fixture.cn-beijing.maas.aliyuncs.com"],
  ["Singapore workspace", "dedicated", "ap-southeast-1", "https://llm-singapore-fixture.ap-southeast-1.maas.aliyuncs.com", "https://llm-singapore-fixture.ap-southeast-1.maas.aliyuncs.com"],
  ["Beijing shared", "shared", "cn-beijing", "", "https://dashscope.aliyuncs.com"],
  ["Singapore shared", "shared", "ap-southeast-1", "", "https://dashscope-intl.aliyuncs.com"]
]) {
  test("UI save reload request pipeline selects " + item[0], () => {
    const first = makeRuntime(); save(first, item[1], item[2], item[3]);
    const second = makeRuntime(first.storage.value());
    assert.equal(second.manager.getProviderConfig("aliyun-bailian").endpointMode, item[1]);
    assert.equal(new URL(request(second.builtIn).url).origin, item[4]);
  });
}

test("shared mode never calls the workspace host builder", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "shared", "cn-beijing", "https://llm-unused-fixture.cn-beijing.maas.aliyuncs.com");
  assert.equal(new URL(request(provider).url).origin, "https://dashscope.aliyuncs.com");
  assert.doesNotMatch(request(provider).url, /\.maas\.aliyuncs\.com/);
});
test("workspace mode never calls the shared host builder", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "dedicated", "cn-beijing", "https://llm-private-fixture.cn-beijing.maas.aliyuncs.com");
  assert.match(request(provider).url, /^https:\/\/llm-private-fixture\.cn-beijing\.maas\.aliyuncs\.com\//);
  assert.doesNotMatch(request(provider).url, /^https:\/\/dashscope\./);
});
test("shared Qwen image requests do not invent a workspace header", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "shared", "cn-beijing", "");
  assert.equal(Object.prototype.hasOwnProperty.call(request(provider).headers, "X-DashScope-WorkSpace"), false);
});
test("saving settings refreshes the existing provider instance and revision", () => {
  const runtime = makeRuntime(); const original = runtime.builtIn;
  save(runtime, "shared", "cn-beijing", ""); const revision = original.config.providerConfigRevision;
  const updated = save(runtime, "shared", "ap-southeast-1", "");
  assert.equal(updated, original); assert.equal(updated.config.providerConfigRevision, revision + 1);
  assert.equal(new URL(request(updated).url).origin, "https://dashscope-intl.aliyuncs.com");
});
test("page reload and Photoshop restart simulation preserve configuration", () => {
  const first = makeRuntime(); save(first, "dedicated", "ap-southeast-1", "https://llm-restart-fixture.ap-southeast-1.maas.aliyuncs.com");
  const pageReload = makeRuntime(first.storage.value()); const photoshopRestart = makeRuntime(pageReload.storage.value());
  assert.deepEqual(photoshopRestart.manager.getProviderConfig("aliyun-bailian"), pageReload.manager.getProviderConfig("aliyun-bailian"));
});
test("schema migration persists once and does not rewrite every startup", () => {
  const old = JSON.stringify([{ id: "aliyun-bailian", type: "aliyun-bailian", region: "cn-beijing",
    workspaceId: "https://llm-migration-fixture.cn-beijing.maas.aliyuncs.com", endpointMode: "dedicated", modelId: "qwen-image-3.0" }]);
  const first = makeRuntime(old); assert.equal(first.storage.writes, 1);
  const second = makeRuntime(first.storage.value()); assert.equal(second.storage.writes, 0);
  assert.equal(second.builtIn.config.configSchemaVersion, catalog.ALIYUN_BAILIAN_CONFIG_SCHEMA_VERSION);
});
test("placeholder and masked Workspace values cannot be saved as usable hosts", () => {
  for (const value of ["<WorkspaceId>", "Workspace ID", "llm-••••1234", "example-workspace"]) {
    assert.equal(catalog.parseAliyunDedicatedApiHost(value).valid, false);
    assert.equal(catalog.resolveAliyunBailianBaseUrl("cn-beijing", value, "dedicated"), "");
  }
});
test("Workspace surrounding whitespace is trimmed without changing a real ID", () => {
  assert.equal(uiConfig("dedicated", "cn-beijing", "  https://llm-trim-fixture.cn-beijing.maas.aliyuncs.com  ").dedicatedApiHost, "https://llm-trim-fixture.cn-beijing.maas.aliyuncs.com");
});
test("duplicate Aliyun provider IDs resolve to the last active configuration", () => {
  const seed = JSON.stringify([
    { id: "aliyun-bailian", type: "aliyun-bailian", endpointMode: "shared", region: "cn-beijing", modelId: "qwen-image-3.0" },
    { id: "aliyun-bailian", type: "aliyun-bailian", endpointMode: "shared", region: "ap-southeast-1", modelId: "qwen-image-3.0" }
  ]);
  const runtime = makeRuntime(seed);
  assert.equal(runtime.manager.listConfiguredProviders().filter((item) => item.id === "aliyun-bailian").length, 1);
  assert.equal(runtime.builtIn.config.region, "ap-southeast-1");
});
test("a new task ignores stale request metadata after a config revision change", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "shared", "cn-beijing", "");
  const stale = { providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "fixture", imageInputs: {},
    aspectRatio: "1:1", resolutionTier: "1K",
    providerMetadata: { endpointMode: "dedicated", region: "cn-beijing", workspaceId: "https://llm-stale-fixture.cn-beijing.maas.aliyuncs.com", providerConfigRevision: 0 } };
  const http = provider.buildHttpRequest(provider.definition.submit, stale, null, {});
  assert.equal(new URL(http.url).origin, "https://dashscope.aliyuncs.com");
});
test("Recovery keeps its saved task origin while a new task uses the latest config", () => {
  const runtime = makeRuntime(); let provider = save(runtime, "dedicated", "cn-beijing", "https://llm-recovery-fixture.cn-beijing.maas.aliyuncs.com");
  const task = { id: "task-fixture", pollUrl: "https://llm-recovery-fixture.cn-beijing.maas.aliyuncs.com/api/v1/tasks/task-fixture",
    requestConfiguration: { endpointMode: "dedicated", region: "cn-beijing", dedicatedApiHost: "https://llm-recovery-fixture.cn-beijing.maas.aliyuncs.com", providerConfigRevision: 1 } };
  provider = save(runtime, "shared", "ap-southeast-1", "");
  assert.equal(new URL(request(provider, task).url).origin, "https://llm-recovery-fixture.cn-beijing.maas.aliyuncs.com");
  assert.equal(new URL(request(provider).url).origin, "https://dashscope-intl.aliyuncs.com");
});
test("submit and poll origins and their diagnostics fingerprints match", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "dedicated", "cn-beijing", "https://llm-origin-fixture.cn-beijing.maas.aliyuncs.com");
  const submit = request(provider); const task = { id: "task", requestConfiguration: provider.getHistoryMetadata() };
  const poll = request(provider, task);
  assert.equal(new URL(submit.url).origin, new URL(poll.url).origin);
  assert.equal(submit.diagnostics.submitOriginFingerprint, submit.diagnostics.pollOriginFingerprint);
});
test("workspace preflight blocks invalid IDs before the HTTP client", async () => {
  let calls = 0;
  const instance = new AliyunBailianProvider({ endpointMode: "dedicated", region: "cn-beijing", workspaceId: "invalid",
    modelId: "qwen-image-3.0" }, { secretStore: secretStore(), apiClient: { requestJson() { calls += 1; } } });
  await assert.rejects(instance.submit({ modelId: "qwen-image-3.0" }, {}), (error) => error.code === ErrorCodes.BAILIAN_WORKSPACE_REQUIRED);
  assert.equal(calls, 0);
});
test("shared preflight resolves only the selected shared origin", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "shared", "ap-southeast-1", "https://llm-ignored-fixture.cn-beijing.maas.aliyuncs.com");
  assert.equal(provider.assertSubmitConfiguration({ modelId: "qwen-image-3.0" }).endpointMode, "shared");
  assert.equal(new URL(request(provider).url).origin, "https://dashscope-intl.aliyuncs.com");
});
test("diagnostics expose only safe configuration facts and fingerprints", () => {
  const runtime = makeRuntime(); const provider = save(runtime, "dedicated", "cn-beijing", "https://llm-secret-fixture.cn-beijing.maas.aliyuncs.com");
  const diagnostics = request(provider).diagnostics; const text = JSON.stringify(diagnostics);
  assert.equal(diagnostics.endpointMode, "dedicated"); assert.equal(diagnostics.hostType, "workspace-dedicated");
  assert.ok(diagnostics.apiHostFingerprint); assert.ok(diagnostics.submitOriginFingerprint);
  assert.doesNotMatch(text, /llm-secret-fixture|fixture-key-never-sent|Authorization/);
});
test("generation UI marks Aliyun edits as unsaved instead of silently applying them", () => {
  let message = "", className = "";
  SettingsPanel.prototype.markAliyunDirty.call({ isAliyunMode: true, message: { set textContent(value) { message = value; },
    set className(value) { className = value; } }, t(key) { return key; } });
  assert.equal(message, "aliyunConfigUnsaved"); assert.equal(className, "status-warning");
});
test("config save never stores the API key", () => {
  const runtime = makeRuntime(); runtime.manager.saveProviderConfig(uiConfig("shared", "cn-beijing", ""), "new-secret",
    { keyAction: KEY_UPDATED });
  assert.doesNotMatch(runtime.storage.value(), /new-secret|apiKey|Authorization/);
});
