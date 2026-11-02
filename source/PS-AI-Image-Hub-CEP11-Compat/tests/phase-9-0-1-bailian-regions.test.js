"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { ProviderStore } = require("../client/js/storage/providerStore");
const { ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const { createTranslator } = require("../client/js/i18n");

function memoryStorage() { const values = new Map(); return { values, getItem(k) { return values.get(k) || null; }, setItem(k, v) { values.set(k, String(v)); } }; }
function provider(config, key) { return new AliyunBailianProvider(config, { secretStore: { get() { return key === undefined ? "fixture-key" : key; } },
  apiClient: { requestJson() { throw new Error("offline"); } } }); }
function request(metadata) { return { providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "fixture", aspectRatio: "1:1",
  resolutionTier: "1K", imageInputs: { mainImage: null, referenceImages: [] }, providerMetadata: metadata }; }

test("platform region catalog retains five known regions", () => {
  assert.deepEqual(catalog.ALIYUN_BAILIAN_REGION_CATALOG.map((item) => item.id),
    ["cn-beijing", "ap-southeast-1", "eu-central-1", "ap-northeast-1", "cn-hongkong"]);
});
test("Qwen Image supports Beijing and Singapore only", () => {
  assert.deepEqual(catalog.getAliyunBailianSupportedRegions("qwen-image-3.0").map((item) => item.id), ["cn-beijing", "ap-southeast-1"]);
});
test("missing or unsupported Region never silently falls back to Beijing", () => {
  assert.equal(catalog.normalizeAliyunBailianConfig({ endpointMode: "shared" }).region, "");
  assert.equal(catalog.normalizeAliyunBailianConfig({ endpointMode: "shared", region: "eu-central-1" }).region, "");
});
test("Provider Store persists endpoint mode Region and full dedicated Host without API key", () => {
  const storage = memoryStorage(); const store = new ProviderStore({ storage });
  store.save([catalog.normalizeAliyunBailianConfig({ endpointMode: "dedicated", region: "ap-southeast-1",
    dedicatedApiHost: "https://tenant.ap-southeast-1.maas.aliyuncs.com" })]);
  const loaded = store.load()[0]; assert.equal(loaded.endpointMode, "dedicated"); assert.equal(loaded.region, "ap-southeast-1");
  assert.equal(loaded.dedicatedApiHost, "https://tenant.ap-southeast-1.maas.aliyuncs.com");
  assert.doesNotMatch(Array.from(storage.values.values()).join(""), /fixture-key|apiKey|Authorization/i);
});
test("shared URL builders use the documented regional origins", () => {
  assert.equal(catalog.buildBailianSubmitUrl("", "cn-beijing", "shared"), "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
  assert.equal(catalog.buildBailianPollUrl("", "ap-southeast-1", "task/one", "shared"), "https://dashscope-intl.aliyuncs.com/api/v1/tasks/task%2Fone");
});
test("dedicated URL builders normalize API path and preserve one origin", () => {
  const host = "https://tenant.cn-beijing.maas.aliyuncs.com/api/v1";
  assert.equal(catalog.buildBailianSubmitUrl(host, "cn-beijing", "dedicated"), "https://tenant.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
  assert.equal(catalog.buildBailianPollUrl(host, "cn-beijing", "task", "dedicated"), "https://tenant.cn-beijing.maas.aliyuncs.com/api/v1/tasks/task");
});
test("dedicated Host accepts llm ws and other safe DNS labels", () => {
  for (const label of ["llm-fixture", "ws-fixture", "tenant-42"]) assert.equal(
    catalog.parseAliyunDedicatedApiHost("https://" + label + ".cn-beijing.maas.aliyuncs.com").valid, true);
});
test("missing Region dedicated Host and API key expose specific errors", () => {
  const cases = [
    [provider({ endpointMode: "shared", region: "", modelId: "qwen-image-3.0" }), ErrorCodes.BAILIAN_REGION_REQUIRED],
    [provider({ endpointMode: "dedicated", region: "cn-beijing", dedicatedApiHost: "", modelId: "qwen-image-3.0" }), ErrorCodes.BAILIAN_WORKSPACE_REQUIRED],
    [provider({ endpointMode: "shared", region: "cn-beijing", modelId: "qwen-image-3.0" }, ""), ErrorCodes.BAILIAN_API_KEY_REQUIRED]
  ];
  cases.forEach(([instance, code]) => { assert.equal(instance.validateConfig().code, code); assert.equal(typeof toUserMessage({ code }, createTranslator("zh-CN")), "string"); });
});
test("dedicated Provider submit and poll use the same origin and no full Host diagnostics", () => {
  const instance = provider({ endpointMode: "dedicated", region: "cn-beijing", dedicatedApiHost: "https://private-name.cn-beijing.maas.aliyuncs.com", modelId: "qwen-image-3.0" });
  const input = request(instance.getHistoryMetadata()); const submit = instance.buildHttpRequest(instance.definition.submit, input, null, {});
  const task = { id: "task", requestConfiguration: instance.getHistoryMetadata() }; const poll = instance.buildHttpRequest(instance.definition.poll, null, task, {});
  assert.equal(new URL(submit.url).origin, new URL(poll.url).origin); assert.doesNotMatch(JSON.stringify(submit.diagnostics), /private-name|fixture-key|Authorization/);
});
test("shared Provider does not emit a workspace header", () => {
  const instance = provider({ endpointMode: "shared", region: "cn-beijing", modelId: "qwen-image-3.0" });
  const http = instance.buildHttpRequest(instance.definition.submit, request(instance.getHistoryMetadata()), null, {});
  assert.equal(Object.prototype.hasOwnProperty.call(http.headers, "X-DashScope-WorkSpace"), false);
});
test("Settings renders mode Region and dedicated Host without changing Generic Async Core", () => {
  const settings = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  assert.match(settings, /id="aliyun-endpoint-mode"/); assert.match(settings, /id="aliyun-region"/); assert.match(settings, /id="aliyun-dedicated-api-host"/);
  const core = ["asyncTaskProvider.js", "asyncTaskDefinition.js"].map((name) => fs.readFileSync(path.resolve(__dirname, "../client/js/providers", name), "utf8")).join("\n");
  assert.doesNotMatch(core, /aliyun|bailian|qwen/i);
});
