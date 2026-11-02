"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/aliyunBailianCatalog");
const builder = require("../client/js/providers/aliyunBailianRequestBuilder");
const definitions = require("../client/js/providers/aliyunBailianDefinition");
const { AliyunBailianProvider } = require("../client/js/providers/aliyunBailianProvider");
const { AppError, ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");

const runtime = path.resolve(__dirname, "..");
function source(relative) { return fs.readFileSync(path.join(runtime, relative), "utf8"); }
function secretStore() { return { get() { return "fixture-key-never-sent"; } }; }
function request(overrides) {
  return Object.assign({ providerId: "aliyun-bailian", modelId: "qwen-image-3.0", prompt: "离线夹具",
    aspectRatio: "1:1", resolutionTier: "1K", promptExtend: true, enableThinking: true,
    imageInputs: { mainImage: null, referenceImages: [] } }, overrides || {});
}
function provider(config, apiClient) {
  return new AliyunBailianProvider(Object.assign({ endpointMode: "dedicated", region: "cn-beijing",
    dedicatedApiHost: "https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", modelId: "qwen-image-3.0" }, config || {}), {
    secretStore: secretStore(), apiClient: apiClient || { requestJson() { throw new Error("offline-only"); } }
  });
}
function translate(dictionary) { return function t(key, values) {
  let text = dictionary[key] || key;
  Object.keys(values || {}).forEach((name) => { text = text.replace(new RegExp("\\{" + name + "\\}", "g"), values[name]); });
  return text;
}; }

test("workspace endpoint uses the official Beijing host", () => {
  assert.equal(catalog.buildBailianSubmitUrl("https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", "cn-beijing", "dedicated"),
    "https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
});
test("workspace endpoint uses the official Singapore host", () => {
  assert.equal(catalog.buildBailianSubmitUrl("https://llm-workspace-fixture.ap-southeast-1.maas.aliyuncs.com", "ap-southeast-1", "dedicated"),
    "https://llm-workspace-fixture.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
});
test("public Qwen Image region choices remain Beijing and Singapore only", () => {
  assert.deepEqual(catalog.getAliyunBailianSupportedRegions("qwen-image-3.0").map((item) => item.id),
    ["cn-beijing", "ap-southeast-1"]);
});
test("missing region is preserved instead of guessed", () => {
  assert.equal(catalog.normalizeAliyunBailianConfig({ workspaceId: "workspace-fixture" }).region, "");
});
test("legacy Beijing shared host migrates without a workspace ID", () => {
  const value = catalog.normalizeAliyunBailianConfig({ baseUrl: "https://dashscope.aliyuncs.com" });
  assert.equal(value.region, "cn-beijing"); assert.equal(value.endpointMode, "shared");
});
test("legacy Singapore shared host migrates without a workspace ID", () => {
  const value = catalog.normalizeAliyunBailianConfig({ baseUrl: "https://dashscope-intl.aliyuncs.com/" });
  assert.equal(value.region, "ap-southeast-1"); assert.equal(value.endpointMode, "shared");
});
test("legacy Beijing shared submit URL remains official", () => {
  assert.equal(catalog.buildBailianSubmitUrl("", "cn-beijing", "shared"),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
});
test("legacy Singapore shared poll URL remains official", () => {
  assert.equal(catalog.buildBailianPollUrl("", "ap-southeast-1", "task fixture", "shared"),
    "https://dashscope-intl.aliyuncs.com/api/v1/tasks/task%20fixture");
});
test("third-party legacy host is never retained", () => {
  const value = catalog.normalizeAliyunBailianConfig({ baseUrl: "https://third-party.example/api/v1" });
  assert.equal(value.baseUrl, ""); assert.equal(value.region, "");
});

for (const invalid of ["https://workspace", "http://workspace", "workspace/path", "workspace?x=1", "workspace#x", "user@workspace"]) {
  test("unsafe Workspace ID is rejected: " + invalid, () => assert.equal(catalog.parseAliyunDedicatedApiHost(invalid).valid, false));
}
test("valid Workspace ID uses the documented llm prefix", () => assert.equal(catalog.parseAliyunDedicatedApiHost("https://llm-1234-abcd.cn-beijing.maas.aliyuncs.com").valid, true));
test("a generic DNS label is not accepted as an official Workspace ID", () => assert.equal(catalog.parseAliyunDedicatedApiHost("ws-1234-abcd").valid, false));
test("invalid region cannot construct an endpoint", () => assert.equal(catalog.resolveAliyunBailianBaseUrl("invalid", "https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", "dedicated"), ""));
test("URL construction contains exactly one api v1 prefix", () => {
  const url = catalog.buildBailianSubmitUrl("https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", "cn-beijing", "dedicated");
  assert.equal((url.match(/\/api\/v1/g) || []).length, 1);
});
test("submit and poll reuse one workspace origin", () => {
  const submit = new URL(catalog.buildBailianSubmitUrl("https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", "cn-beijing", "dedicated"));
  const poll = new URL(catalog.buildBailianPollUrl("https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", "cn-beijing", "task", "dedicated"));
  assert.equal(submit.origin, poll.origin);
});
test("submit and poll reuse one shared origin", () => {
  const submit = new URL(catalog.buildBailianSubmitUrl("", "ap-southeast-1", "shared"));
  const poll = new URL(catalog.buildBailianPollUrl("", "ap-southeast-1", "task", "shared"));
  assert.equal(submit.origin, poll.origin);
});

test("async definition uses the documented submit path and headers", () => {
  const definition = definitions.createAliyunBailianAsyncDefinition();
  const headers = definition.submit.headersBuilder({ apiKey: "fixture-key" });
  assert.equal(definition.submit.endpoint, "/api/v1/services/aigc/image-generation/generation");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-DashScope-Async"], "enable");
  assert.equal(headers.Authorization, "Bearer fixture-key");
});
test("poll definition uses the documented task path", () => {
  assert.equal(definitions.createAliyunBailianAsyncDefinition().poll.endpointTemplate, "/api/v1/tasks/{taskId}");
});
test("qwen-image-3.0 text request matches the DashScope message schema", () => {
  const body = builder.buildAliyunBailianRequestBody(request());
  assert.equal(body.model, "qwen-image-3.0");
  assert.deepEqual(body.input.messages, [{ role: "user", content: [{ text: "离线夹具" }] }]);
});
test("qwen-image-3.0-pro uses the same documented schema", () => {
  const body = builder.buildAliyunBailianRequestBody(request({ modelId: "qwen-image-3.0-pro" }));
  assert.equal(body.model, "qwen-image-3.0-pro"); assert.equal(body.input.messages.length, 1);
});
test("text generation never sends null or empty image", () => {
  const text = JSON.stringify(builder.buildAliyunBailianRequestBody(request()));
  assert.doesNotMatch(text, /\"image\"/);
});
test("image generation adds only a valid image object", () => {
  const body = builder.buildAliyunBailianRequestBody(request({ imageInputs: {
    mainImage: { url: "https://fixture.example/input.png" }, referenceImages: [] } }));
  assert.equal(body.input.messages[0].content[0].image, "https://fixture.example/input.png");
});
test("n remains an integer and prompt_extend remains boolean", () => {
  const parameters = builder.buildAliyunBailianRequestBody(request()).parameters;
  assert.equal(parameters.n, 1); assert.equal(typeof parameters.n, "number");
  assert.equal(parameters.prompt_extend, true); assert.equal(typeof parameters.prompt_extend, "boolean");
});
test("DashScope size uses an asterisk separator", () => {
  const size = builder.buildAliyunBailianRequestBody(request()).parameters.size;
  assert.equal(size, "1024*1024"); assert.doesNotMatch(size, /x/);
});
test("empty seed is omitted and maximum integer seed is accepted", () => {
  const empty = builder.buildAliyunBailianRequestBody(request({ seed: "" })).parameters;
  const maximum = builder.buildAliyunBailianRequestBody(request({ seed: "2147483647" })).parameters;
  assert.equal(Object.prototype.hasOwnProperty.call(empty, "seed"), false); assert.equal(maximum.seed, 2147483647);
});

test("provider saves endpoint mode in task recovery configuration", () => {
  const value = provider().createTask({ output: { task_id: "task-fixture", task_status: "PENDING" } }, request({
    providerMetadata: { endpointMode: "dedicated", region: "cn-beijing", dedicatedApiHost: "https://llm-workspace-fixture.cn-beijing.maas.aliyuncs.com", providerConfigRevision: 0 } }));
  assert.equal(value.requestConfiguration.endpointMode, "dedicated");
  assert.match(value.pollUrl, /^https:\/\/llm-workspace-fixture\.cn-beijing\.maas\.aliyuncs\.com\//);
});
test("shared configuration validates without inventing a Workspace ID", () => {
  assert.equal(provider({ endpointMode: "shared", region: "cn-beijing", workspaceId: "" }).validateConfig().valid, true);
});
test("workspace configuration requires a Workspace ID", () => {
  const result = provider({ endpointMode: "dedicated", dedicatedApiHost: "" }).validateConfig();
  assert.equal(result.valid, false); assert.equal(result.code, ErrorCodes.BAILIAN_WORKSPACE_REQUIRED);
});
test("workspace configuration rejects a full URL as Workspace ID", () => {
  const result = provider({ dedicatedApiHost: "https://workspace.example" }).validateConfig();
  assert.equal(result.valid, false); assert.equal(result.code, ErrorCodes.BAILIAN_WORKSPACE_REQUIRED);
});
test("HTTP 400 Workspace error is mapped without polling", async () => {
  let calls = 0;
  const instance = provider({}, { requestJson() { calls += 1; return Promise.reject(new AppError(ErrorCodes.HTTP_CLIENT,
    "HTTP request failed", { status: 400, serviceMessage: "Workspace endpoint is invalid.", serviceCode: "InvalidParameter",
      provider: "aliyun-bailian", stage: "asyncSubmit" })); } });
  await assert.rejects(instance.generate(request(), {}), (error) => error.code === ErrorCodes.BAILIAN_WORKSPACE_ENDPOINT_INVALID);
  assert.equal(calls, 1);
});
test("InvalidApiKey is distinguished from generic HTTP 400", async () => {
  const instance = provider({}, { requestJson() { return Promise.reject(new AppError(ErrorCodes.HTTP_CLIENT,
    "HTTP request failed", { status: 400, serviceMessage: "Invalid API-key provided.", serviceCode: "InvalidApiKey" })); } });
  await assert.rejects(instance.submit(request(), {}), (error) => error.code === ErrorCodes.AUTH_ERROR);
});
test("ModelNotFound is distinguished from generic HTTP 400", async () => {
  const instance = provider({}, { requestJson() { return Promise.reject(new AppError(ErrorCodes.HTTP_CLIENT,
    "HTTP request failed", { status: 400, serviceMessage: "Model not found", serviceCode: "ModelNotFound" })); } });
  await assert.rejects(instance.submit(request(), {}), (error) => error.code === ErrorCodes.MODEL_REQUIRED);
});
test("workspace endpoint error has precise Chinese guidance", () => {
  const message = toUserMessage(new AppError(ErrorCodes.BAILIAN_WORKSPACE_ENDPOINT_INVALID, "failed"), translate(zhCN));
  assert.match(message, /专属 API Host/);
});
test("workspace endpoint error has precise English guidance", () => {
  const message = toUserMessage(new AppError(ErrorCodes.BAILIAN_WORKSPACE_ENDPOINT_INVALID, "failed"), translate(enUS));
  assert.match(message, /dedicated API Host/);
});
test("settings expose explicit endpoint mode region workspace and consistency guidance", () => {
  const ui = source("client/js/ui/settingsPanel.js");
  assert.match(ui, /aliyun-endpoint-mode/); assert.match(ui, /aliyun-dedicated-api-host/);
  assert.match(ui, /bailianDedicatedApiHostHint/);
});
test("request diagnostics never log Authorization or an API key value", () => {
  const implementation = source("client/js/providers/aliyunBailianProvider.js");
  const configured = implementation.slice(implementation.indexOf("BAILIAN_REQUEST_CONFIGURED"));
  assert.doesNotMatch(configured, /Authorization|apiKey\s*:/);
});
test("formal identity and CEP manifest remain unchanged", () => {
  const manifest = source("CSXS/manifest.xml");
  assert.match(manifest, /com\.psai\.imagehub\.compat\.cep11\.panel/);
  assert.match(manifest, /\[23\.0,26\.0\)/); assert.match(manifest, /Name=\"CSXS\" Version=\"11\.0\"/);
});
test("formal v1.1.0 includes Auto Sharpen and excludes Auto Color Fusion", () => {
  assert.equal(fs.existsSync(path.join(runtime, "client/js/photoshop/autoSharpenManager.js")), true);
  assert.equal(fs.existsSync(path.join(runtime, "client/js/photoshop/autoColorFusionManager.js")), false);
});
