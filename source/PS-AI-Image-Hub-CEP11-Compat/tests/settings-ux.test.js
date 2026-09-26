"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");
const { createTranslator } = require("../client/js/i18n");
const {
  PROVIDER_TOOLTIP_KEYS,
  getProviderFieldVisibility,
  getResultTypeVisibility,
  getSettingsSectionVisibility,
  getConfigValidationKey
} = require("../client/js/ui/settingsPanel");

function completeConfig(overrides) {
  return Object.assign({
    displayName: "测试 Provider",
    type: "openai-compatible",
    baseUrl: "https://api.example.com",
    endpointPath: "/images",
    authType: "bearer",
    customHeaderName: "",
    modelId: "official-model-id",
    resultType: "auto",
    responsePath: "",
    pollingEndpoint: "",
    pollingResultPath: ""
  }, overrides || {});
}

test("Provider Type visibility keeps common fields and reveals only relevant advanced fields", () => {
  const openai = getProviderFieldVisibility("openai-compatible", "bearer");
  assert.equal(openai.baseUrl && openai.endpoint && openai.apiKey && openai.modelId && openai.responseType, true);
  assert.equal(openai.responsePath, false);
  assert.equal(openai.requestTemplate, false);
  assert.equal(openai.pollingEndpoint, false);

  const generic = getProviderFieldVisibility("generic-rest", "bearer");
  assert.equal(generic.responsePath, true);
  assert.equal(generic.requestTemplate, true);
  assert.equal(generic.pollingEndpoint, false);

  const asyncTask = getProviderFieldVisibility("async-task", "bearer");
  assert.equal(asyncTask.responsePath, true);
  assert.equal(asyncTask.pollingEndpoint, true);
  assert.equal(asyncTask.pollingResultPath, true);
  assert.equal(asyncTask.requestTemplate, false);
});

test("Custom Header field appears only for custom-header authentication", () => {
  assert.equal(getProviderFieldVisibility("generic-rest", "custom-header").customHeader, true);
  assert.equal(getProviderFieldVisibility("generic-rest", "bearer").customHeader, false);
  assert.equal(getProviderFieldVisibility("generic-rest", "x-api-key").customHeader, false);
});

test("Synchronous and Async Provider types expose only compatible result choices", () => {
  assert.deepEqual(getResultTypeVisibility("openai-compatible"), { auto: true, url: true, base64: true, "task-id": false });
  assert.deepEqual(getResultTypeVisibility("generic-rest"), { auto: true, url: true, base64: true, "task-id": false });
  assert.deepEqual(getResultTypeVisibility("async-task"), { auto: false, url: false, base64: false, "task-id": true });
});

test("Basic settings remain visible while Advanced settings default to collapsed", () => {
  assert.deepEqual(getSettingsSectionVisibility(false), { basic: true, advanced: false });
  assert.deepEqual(getSettingsSectionVisibility(true), { basic: true, advanced: true });
});

test("Every Provider tooltip key exists in both locales", () => {
  PROVIDER_TOOLTIP_KEYS.forEach((key) => {
    assert.equal(typeof zhCN[key], "string", "Missing zh-CN tooltip: " + key);
    assert.equal(zhCN[key].length > 12, true, "zh-CN tooltip is too short: " + key);
    assert.equal(typeof enUS[key], "string", "Missing en-US tooltip: " + key);
  });
});

test("zh-CN and en-US dictionaries expose the same complete key set", () => {
  assert.deepEqual(Object.keys(zhCN).sort(), Object.keys(enUS).sort());
});

test("Provider configuration errors map to specific Simplified Chinese instructions", () => {
  const t = createTranslator("zh-CN");
  const cases = [
    [completeConfig({ displayName: "" }), true, "errorProviderNameRequired", /API 服务名称/],
    [completeConfig({ baseUrl: "" }), true, "errorMissingBaseUrl", /Base URL/],
    [completeConfig({ endpointPath: "" }), true, "errorMissingEndpoint", /Endpoint/],
    [completeConfig(), false, "errorMissingApiKey", /API Key/],
    [completeConfig({ modelId: "" }), true, "errorModelIdRequired", /Model ID/],
    [completeConfig({ authType: "custom-header" }), true, "errorCustomHeaderRequired", /Header/],
    [completeConfig({ type: "generic-rest" }), true, "errorResponsePathRequired", /JSON 路径/],
    [completeConfig({ type: "async-task", responsePath: "task_id" }), true, "errorAsyncFieldsRequired", /Polling Endpoint/]
  ];
  cases.forEach(([config, hasSecret, expectedKey, messagePattern]) => {
    const key = getConfigValidationKey(config, hasSecret);
    assert.equal(key, expectedKey);
    assert.match(t(key), messagePattern);
  });
});

test("Settings form IDs remain mapped to every persisted Provider config field", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/settingsPanel.js"), "utf8");
  const fieldIds = [
    "provider-name", "provider-type", "provider-base-url", "provider-endpoint", "provider-api-key",
    "provider-auth-type", "provider-custom-header", "provider-model", "provider-result-type",
    "provider-response-path", "provider-template", "provider-polling-endpoint", "provider-polling-path"
  ];
  fieldIds.forEach((id) => assert.match(source, new RegExp('id="' + id + '"')));
  ["displayName", "type", "baseUrl", "endpointPath", "authType", "customHeaderName", "modelId", "resultType", "responsePath", "requestBodyTemplate", "pollingEndpoint", "pollingResultPath"]
    .forEach((property) => assert.match(source, new RegExp(property + ":")));
});
