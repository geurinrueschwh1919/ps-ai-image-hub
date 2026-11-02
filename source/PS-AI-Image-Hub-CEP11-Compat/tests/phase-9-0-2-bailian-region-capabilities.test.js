"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { SettingsPanel } = require("../client/js/ui/settingsPanel");
const { ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const { createTranslator } = require("../client/js/i18n");

const QWEN_REGIONS = ["cn-beijing", "ap-southeast-1"];
function secrets() { return { get() { return "fixture-key"; } }; }
function make(config) { return new AliyunBailianProvider(Object.assign({ endpointMode: "shared", region: "cn-beijing", modelId: "qwen-image-3.0" }, config || {}),
  { secretStore: secrets(), apiClient: { requestJson() { throw new Error("offline"); } } }); }

test("Qwen Image 3.0 declares only Beijing and Singapore", () => assert.deepEqual(catalog.getAliyunBailianModel("qwen-image-3.0").supportedRegions, QWEN_REGIONS));
test("Qwen Image 3.0 Pro declares only Beijing and Singapore", () => assert.deepEqual(catalog.getAliyunBailianModel("qwen-image-3.0-pro").supportedRegions, QWEN_REGIONS));
test("model capability options contain only Beijing and Singapore", () => assert.deepEqual(
  catalog.getAliyunBailianSupportedRegions("qwen-image-3.0").map((item) => item.id), QWEN_REGIONS));
test("unsupported saved Region is cleared instead of silently changed", () => {
  assert.equal(catalog.normalizeAliyunBailianConfig({ endpointMode: "shared", modelId: "qwen-image-3.0", region: "cn-hongkong" }).region, "");
});
test("missing saved Region remains empty", () => assert.equal(catalog.normalizeAliyunBailianConfig({ endpointMode: "shared", modelId: "qwen-image-3.0" }).region, ""));
test("unsupported saved Qwen Region is cleared and fails before HTTP", async () => {
  let calls = 0; const instance = new AliyunBailianProvider({ endpointMode: "shared", region: "cn-hongkong", modelId: "qwen-image-3.0" },
    { secretStore: secrets(), apiClient: { requestJson() { calls += 1; } } });
  await assert.rejects(instance.submit({ modelId: "qwen-image-3.0" }), (error) => error.code === ErrorCodes.BAILIAN_REGION_REQUIRED);
  assert.equal(calls, 0);
});
test("missing Region maps to readable Chinese error", () => {
  const validation = make({ region: "" }).validateConfig(); assert.equal(validation.code, ErrorCodes.BAILIAN_REGION_REQUIRED);
  assert.equal(toUserMessage({ code: validation.code }, createTranslator("zh-CN")), "阿里云百炼缺少地域。");
});
test("Beijing shared origin is stable", () => assert.equal(make().config.baseUrl, "https://dashscope.aliyuncs.com"));
test("Singapore shared origin is stable", () => assert.equal(make({ region: "ap-southeast-1" }).config.baseUrl, "https://dashscope-intl.aliyuncs.com"));
test("dedicated Host derives Beijing Region", () => assert.equal(
  catalog.parseAliyunDedicatedApiHost("https://tenant.cn-beijing.maas.aliyuncs.com").region, "cn-beijing"));
test("dedicated Host derives Singapore Region", () => assert.equal(
  catalog.parseAliyunDedicatedApiHost("https://tenant.ap-southeast-1.maas.aliyuncs.com/api/v1").region, "ap-southeast-1"));
test("Settings keeps unsupported Region empty and renders an explicit empty option", () => {
  const previousDocument = global.document; const previousRefresh = global.PSAIImageHubCompat.refreshEnhancedSelect;
  const select = { value: "cn-hongkong", options: [], set innerHTML(value) { this.options = []; this.value = ""; },
    appendChild(option) { this.options.push(option); } };
  const fields = { "aliyun-model": { value: "qwen-image-3.0" }, "aliyun-region": select,
    "aliyun-endpoint-mode": { value: "shared" }, "aliyun-dedicated-api-host": { value: "", disabled: false },
    "aliyun-dedicated-host-field": { hidden: false }, "aliyun-info-endpoint": { textContent: "" } };
  const panel = Object.create(SettingsPanel.prototype); panel.field = (id) => fields[id]; panel.message = { textContent: "", className: "" }; panel.t = createTranslator("zh-CN");
  try { global.document = { createElement() { return { value: "", textContent: "" }; } }; global.PSAIImageHubCompat.refreshEnhancedSelect = function noop() {};
    panel.syncAliyunFields({ notifyFallback: true, preferredRegion: "cn-hongkong" });
    assert.deepEqual(select.options.map((item) => item.value), ["", "cn-beijing", "ap-southeast-1"]); assert.equal(select.value, "");
  } finally { global.document = previousDocument; global.PSAIImageHubCompat.refreshEnhancedSelect = previousRefresh; }
});
test("Generic Async Core remains provider neutral", () => {
  ["asyncTaskProvider.js", "asyncTaskDefinition.js"].forEach((name) => assert.doesNotMatch(
    fs.readFileSync(path.resolve(__dirname, "../client/js/providers", name), "utf8"), /aliyun|bailian|qwen/i));
});
