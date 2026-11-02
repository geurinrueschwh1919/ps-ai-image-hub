"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { ProviderManager, KEY_UNCHANGED } = require("../client/js/ui/providerManager");
const { ProviderStore } = require("../client/js/storage/providerStore");
const { SettingsPanel } = require("../client/js/ui/settingsPanel");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");

function memoryStorage(seed) {
  let value = seed || null;
  return { writes: 0, getItem() { return value; }, setItem(key, next) { value = next; this.writes += 1; }, value() { return value; } };
}
function secrets() {
  const values = { "provider:aliyun-bailian:apiKey": "fixture-secret-never-sent" };
  return { get(key) { return values[key] || null; }, set(key, value) { values[key] = value; }, remove(key) { delete values[key]; }, forget() {}, isRemembered() { return false; } };
}
function runtime(seed) {
  const storage = memoryStorage(seed); const providerStore = new ProviderStore({ storage }); const secretStore = secrets();
  const registry = new ProviderRegistry(); const deps = { secretStore, apiClient: { requestJson() { throw new Error("offline fixture"); } } };
  const builtIn = new AliyunBailianProvider({}, deps); registry.register(builtIn);
  const factory = { create(config) { return new AliyunBailianProvider(config, deps); } };
  const manager = new ProviderManager(registry, { providerStore, secretStore, providerFactory: factory }); manager.loadConfiguredProviders();
  return { storage, builtIn, manager };
}
function uiConfig(endpointMode, region, dedicatedApiHost) {
  const values = { "aliyun-endpoint-mode": endpointMode, "aliyun-region": region,
    "aliyun-dedicated-api-host": dedicatedApiHost, "aliyun-model": "qwen-image-3.0" };
  return SettingsPanel.prototype.collectAliyunConfig.call({ field(id) { return { value: values[id] }; } });
}
function save(state, mode, region, host) {
  return state.manager.saveProviderConfig(uiConfig(mode, region, host), "", { keyAction: KEY_UNCHANGED });
}
function request(provider, task) {
  const input = { providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "fixture", aspectRatio: "1:1",
    resolutionTier: "1K", providerMetadata: provider.getHistoryMetadata(), imageInputs: { mainImage: null, referenceImages: [] } };
  return provider.buildHttpRequest(task ? provider.definition.poll : provider.definition.submit, input, task || null, {});
}

for (const value of [
  ["Beijing dedicated llm label", "dedicated", "cn-beijing", "https://llm-fixture.cn-beijing.maas.aliyuncs.com", "https://llm-fixture.cn-beijing.maas.aliyuncs.com"],
  ["Beijing dedicated ws label", "dedicated", "cn-beijing", "https://ws-fixture.cn-beijing.maas.aliyuncs.com/api/v1", "https://ws-fixture.cn-beijing.maas.aliyuncs.com"],
  ["Singapore dedicated other safe label", "dedicated", "ap-southeast-1", "https://tenant-42.ap-southeast-1.maas.aliyuncs.com/", "https://tenant-42.ap-southeast-1.maas.aliyuncs.com"],
  ["Beijing shared", "shared", "cn-beijing", "", "https://dashscope.aliyuncs.com"],
  ["Singapore shared", "shared", "ap-southeast-1", "", "https://dashscope-intl.aliyuncs.com"]
]) test("UI save reload provider request selects " + value[0], () => {
  const first = runtime(); save(first, value[1], value[2], value[3]); const reloaded = runtime(first.storage.value());
  assert.equal(reloaded.builtIn.config.endpointMode, value[1]); assert.equal(new URL(request(reloaded.builtIn).url).origin, value[4]);
});

test("dedicated API Host validation enforces HTTPS no credentials query fragment or third-party domain", () => {
  for (const host of ["http://tenant.cn-beijing.maas.aliyuncs.com", "https://u:p@tenant.cn-beijing.maas.aliyuncs.com",
    "https://tenant.cn-beijing.maas.aliyuncs.com?q=1", "https://tenant.cn-beijing.maas.aliyuncs.com#x", "https://evil.example.com"]) {
    assert.equal(catalog.parseAliyunDedicatedApiHost(host).valid, false, host);
  }
});
test("dedicated host region mismatch is blocked without network", async () => {
  let calls = 0; const provider = new AliyunBailianProvider({ endpointMode: "dedicated", region: "cn-beijing",
    dedicatedApiHost: "https://tenant.ap-southeast-1.maas.aliyuncs.com", modelId: "qwen-image-3.0" },
  { secretStore: secrets(), apiClient: { requestJson() { calls += 1; } } });
  await assert.rejects(provider.submit({ modelId: "qwen-image-3.0" }, {}), (error) => error.code === ErrorCodes.BAILIAN_REGION_MISMATCH);
  assert.equal(calls, 0);
});
test("shared mode ignores a retained dedicated host", () => {
  const state = runtime(); const provider = save(state, "shared", "cn-beijing", "https://tenant.cn-beijing.maas.aliyuncs.com");
  assert.equal(new URL(request(provider).url).origin, "https://dashscope.aliyuncs.com");
  assert.doesNotMatch(request(provider).url, /\.maas\.aliyuncs\.com/);
});
test("saving refreshes the built-in instance and increments revision", () => {
  const state = runtime(); const original = state.builtIn; save(state, "shared", "cn-beijing", ""); const revision = original.config.providerConfigRevision;
  assert.equal(save(state, "shared", "ap-southeast-1", ""), original); assert.equal(original.config.providerConfigRevision, revision + 1);
});
test("migration converts only unambiguous legacy llm IDs and runs once", () => {
  const old = JSON.stringify([{ id: "aliyun-bailian", type: "aliyun-bailian", endpointMode: "workspace", region: "cn-beijing",
    workspaceId: "llm-legacy", modelId: "qwen-image-3.0" }]); const first = runtime(old);
  assert.equal(first.builtIn.config.dedicatedApiHost, "https://llm-legacy.cn-beijing.maas.aliyuncs.com"); assert.equal(first.storage.writes, 1);
  const second = runtime(first.storage.value()); assert.equal(second.storage.writes, 0); assert.equal(second.builtIn.config.configSchemaVersion, 3);
});
test("migration never invents a host from a ws console record ID", () => {
  const config = catalog.normalizeAliyunBailianConfig({ endpointMode: "workspace", region: "cn-beijing", workspaceId: "ws-console-record" });
  assert.equal(config.dedicatedApiHost, ""); assert.equal(config.endpointMode, "dedicated");
});
test("submit and poll reuse one origin and expose fingerprints only", () => {
  const state = runtime(); const provider = save(state, "dedicated", "cn-beijing", "https://tenant-secret.cn-beijing.maas.aliyuncs.com");
  const submit = request(provider); const task = { id: "task", requestConfiguration: provider.getHistoryMetadata() }; const poll = request(provider, task);
  assert.equal(new URL(submit.url).origin, new URL(poll.url).origin); assert.equal(submit.diagnostics.submitOriginFingerprint, submit.diagnostics.pollOriginFingerprint);
  assert.doesNotMatch(JSON.stringify(submit.diagnostics), /tenant-secret|fixture-secret-never-sent|Authorization/);
});
test("stale request metadata is ignored after a saved revision change", () => {
  const state = runtime(); const provider = save(state, "shared", "cn-beijing", "");
  const input = { modelId: "qwen-image-3.0", prompt: "fixture", aspectRatio: "1:1", resolutionTier: "1K",
    providerMetadata: { endpointMode: "dedicated", region: "cn-beijing",
      dedicatedApiHost: "https://stale.cn-beijing.maas.aliyuncs.com", providerConfigRevision: 0 }, imageInputs: {} };
  assert.equal(new URL(provider.buildHttpRequest(provider.definition.submit, input, null, {}).url).origin, "https://dashscope.aliyuncs.com");
});
test("unsaved UI changes show a warning", () => {
  let message = "", className = "";
  SettingsPanel.prototype.markAliyunDirty.call({ isAliyunMode: true, message: { set textContent(value) { message = value; },
    set className(value) { className = value; } }, t(key) { return key; } });
  assert.equal(message, "aliyunConfigUnsaved"); assert.equal(className, "status-warning");
});

test("service Workspace endpoint error maps precisely and does not start polling", async () => {
  let calls = 0;
  const provider = new AliyunBailianProvider({ endpointMode: "dedicated", region: "cn-beijing",
    dedicatedApiHost: "https://tenant.cn-beijing.maas.aliyuncs.com", modelId: "qwen-image-3.0" }, {
    secretStore: secrets(), apiClient: { requestJson() { calls += 1; throw new AppError(ErrorCodes.HTTP_CLIENT,
      "HTTP 400", { status: 400, serviceCode: "InvalidParameter", serviceMessage: "Workspace endpoint is invalid.",
        requestId: "request-fixture-redacted" }); } }
  });
  await assert.rejects(provider.submit({ modelId: "qwen-image-3.0", prompt: "fixture", aspectRatio: "1:1",
    resolutionTier: "1K", imageInputs: { mainImage: null, referenceImages: [] } }, {}),
  (error) => error.code === ErrorCodes.BAILIAN_WORKSPACE_ENDPOINT_INVALID && error.details.status === 400);
  assert.equal(calls, 1);
});
