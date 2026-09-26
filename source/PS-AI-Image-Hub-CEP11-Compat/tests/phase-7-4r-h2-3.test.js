"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../client/js/providers/grsModelCatalog");
const logging = require("../client/js/utils/logger");
const legacy = require("../client/js/providers/grsLegacyAdapter");
const {
  GrsProvider, buildGrsHttpRequest, normalizeGrsConfig, validateGrsNewApiBody,
  parseGrsNewApiTaskState, resolveNewApiGenerateEndpoint, GRS_NEW_API_PROTOCOL,
  GRS_ENDPOINT, GRS_RESULT_ENDPOINT
} = require("../client/js/providers/grsProvider");
const { ErrorCodes } = require("../client/js/utils/errors");

function secrets() { return { get() { return "official-schema-test-key"; } }; }
function request(modelId, extra) {
  return Object.assign({ modelId, prompt: "schema alignment", aspectRatio: "16:9", resolutionTier: "1K",
    imageSize: "1K", replyType: "async", references: [] }, extra || {});
}
function build(modelId, extra, config) {
  return buildGrsHttpRequest(request(modelId, extra), normalizeGrsConfig(Object.assign({ modelId }, config || {})),
    "key", catalog.getGrsModel(modelId));
}

for (const modelId of ["gpt-image-2", "gpt-image-2-vip", "nano-banana-2", "nano-banana-pro"]) {
  test("New " + modelId + " routes to unified POST /v1/api/generate", () => {
    const http = build(modelId);
    assert.equal(http.method, "POST");
    assert.equal(http.endpoint, GRS_ENDPOINT);
    assert.equal(http.url, "https://grsaiapi.com/v1/api/generate");
    assert.equal(http.protocol, GRS_NEW_API_PROTOCOL);
  });
}

test("New API routing is selected by protocol before GPT model-family mapping", () => {
  assert.equal(resolveNewApiGenerateEndpoint("new-api"), "/v1/api/generate");
  assert.throws(() => build("gpt-image-2", null, { protocol: "legacy-api" }),
    (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG && error.details.protocol === "legacy-api");
});

test("New GPT request uses only model/prompt/images/aspectRatio/replyType", () => {
  const body = JSON.parse(build("gpt-image-2", { references: [{ apiValue: "RAW_GPT_IMAGE" }] }).body);
  assert.deepEqual(Object.keys(body).sort(), ["aspectRatio", "images", "model", "prompt", "replyType"].sort());
  assert.deepEqual(body.images, ["RAW_GPT_IMAGE"]);
  assert.equal(body.aspectRatio, "16:9");
  assert.equal(body.replyType, "async");
});

for (const forbidden of ["imageSize", "urls", "webHook", "shutProgress"]) {
  test("New GPT schema validator rejects " + forbidden, () => {
    const body = { model: "gpt-image-2", prompt: "p", images: [], aspectRatio: "16:9", replyType: "async" };
    body[forbidden] = forbidden === "urls" ? [] : forbidden === "imageSize" ? "1K" : false;
    assert.throws(() => validateGrsNewApiBody(body, "gpt-image"),
      (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG && error.details.unexpectedField === forbidden);
  });
}

test("New GPT VIP uses images[] and excludes every Legacy-only field", () => {
  const body = JSON.parse(build("gpt-image-2-vip", { resolutionTier: "2K", imageSize: "2K",
    references: [{ url: "https://input.example/main.png" }] }).body);
  assert.deepEqual(body.images, ["https://input.example/main.png"]);
  ["imageSize", "urls", "webHook", "shutProgress", "quality"].forEach((field) => assert.equal(Object.hasOwn(body, field), false));
});

test("New Nano keeps images/aspectRatio/imageSize/replyType mapping", () => {
  const body = JSON.parse(build("nano-banana-2", { aspectRatio: "16:9", resolutionTier: "2K", imageSize: "2K",
    references: [{ apiValue: "RAW_NANO_IMAGE" }] }).body);
  assert.deepEqual(body, { model: "nano-banana-2", prompt: "schema alignment", images: ["RAW_NANO_IMAGE"],
    aspectRatio: "16:9", replyType: "async", imageSize: "2K" });
});

test("New Nano schema validator rejects Legacy urls[]", () => {
  assert.throws(() => validateGrsNewApiBody({ model: "nano-banana-2", prompt: "p", images: [], aspectRatio: "auto",
    imageSize: "1K", replyType: "async", urls: [] }, "nano-banana"),
  (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG && error.details.unexpectedField === "urls");
});

test("models without confirmed size capability remain unchanged", () => {
  for (const modelId of ["nano-banana-fast", "nano-banana-2-lite"]) {
    assert.equal(catalog.getGrsModel(modelId).supportedImageSizes, null);
    assert.equal(Object.hasOwn(JSON.parse(build(modelId).body), "imageSize"), false);
  }
});

test("gpt-image-2 remains 1K-only and can send the official 16:9 ratio string", () => {
  assert.deepEqual(catalog.getGrsModel("gpt-image-2").resolutionTiers, ["1K"]);
  const body = JSON.parse(build("gpt-image-2", { aspectRatio: "16:9" }).body);
  assert.equal(body.aspectRatio, "16:9");
  assert.equal(Object.hasOwn(body, "imageSize"), false);
});

for (const [tier, pixelSize] of [["1K", "1280x720"], ["2K", "2048x1152"], ["4K", "3840x2160"]]) {
  test("gpt-image-2-vip 16:9 + " + tier + " maps to " + pixelSize, () => {
    const body = JSON.parse(build("gpt-image-2-vip", { aspectRatio: "16:9", resolutionTier: tier, imageSize: tier }).body);
    assert.equal(body.aspectRatio, pixelSize);
    assert.equal(Object.hasOwn(body, "imageSize"), false);
  });
}

test("New Result uses authenticated GET query parameter and no request body", async () => {
  let call;
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson(url, options) {
    call = { url, options }; return { id: "official-result-id", status: "succeeded", results: [] };
  } } });
  await provider.queryTask("official-result-id", { modelId: "gpt-image-2-vip", modelFamily: "gpt" });
  assert.equal(call.url, "https://grsaiapi.com/v1/api/result?id=official-result-id");
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.body, undefined);
  assert.equal(call.options.headers.Authorization, "Bearer official-schema-test-key");
  assert.equal(call.options.timeout, 25000);
  assert.equal(call.options.diagnostics.protocol, "new-api");
});

test("New parser reads only top-level id/status/progress/results/error", () => {
  const state = parseGrsNewApiTaskState({ id: "new", status: "running", progress: 35, results: [], error: "",
    data: { id: "legacy", status: "failed", progress: 100, results: [{ url: "https://wrong.example/x.png" }] } });
  assert.deepEqual(state, { id: "new", status: "running", progress: 35, results: [], error: null });
});

test("Legacy GPT remains isolated on completions + POST result + response.data", () => {
  const generation = legacy.buildGrsLegacyGenerationRequest(request("gpt-image-2", {
    references: [{ url: "https://legacy-input.example/x.png" }] }), { baseUrl: "https://grsaiapi.com" }, "key", catalog.getGrsModel("gpt-image-2"));
  const result = legacy.buildGrsLegacyResultRequest("https://grsaiapi.com", "legacy-id", "key");
  assert.equal(generation.url, "https://grsaiapi.com/v1/draw/completions");
  assert.equal(generation.protocol, "legacy-api");
  assert.deepEqual(JSON.parse(generation.body).urls, ["https://legacy-input.example/x.png"]);
  assert.equal(result.url, "https://grsaiapi.com/v1/draw/result");
  assert.equal(result.method, "POST");
  assert.equal(result.protocol, "legacy-api");
  assert.equal(legacy.parseGrsLegacyResult({ code: 0, data: { id: "legacy-id", status: "succeeded", results: [] } }).id, "legacy-id");
});

test("endpoint diagnostics contain official routing and schema metadata without prompt or credentials", async () => {
  const captured = [];
  const originalInfo = logging.logger.info;
  logging.logger.info = function capture(message, data) { captured.push({ message, data }); };
  try {
    const provider = new GrsProvider({ modelId: "gpt-image-2-vip" }, { secretStore: secrets(), setInterval() { return 1; }, clearInterval() {},
      apiClient: { async requestJson() { return { id: "diag-task-id", status: "succeeded", results: [{ url: "https://files.example/result.png" }] }; } } });
    await provider.generate(request("gpt-image-2-vip", { resolutionTier: "2K", imageSize: "2K",
      references: [{ apiValue: "BASE64_NOT_LOGGED" }, { url: "https://sensitive.example/reference.png" }] }), {});
  } finally { logging.logger.info = originalInfo; }
  const event = captured.find((item) => item.message === "GRS New API endpoint diagnostics");
  assert.ok(event);
  assert.deepEqual(event.data, { protocol: "new-api", model: "gpt-image-2-vip", modelFamily: "gpt", method: "POST",
    endpoint: "/v1/api/generate", replyType: "async", aspectRatio: "2048x1152", hasImageSize: false,
    imageSize: null, imageCount: 2, payloadBytes: event.data.payloadBytes });
  const serialized = JSON.stringify(event.data);
  assert.equal(serialized.includes("schema alignment"), false);
  assert.equal(serialized.includes("official-schema-test-key"), false);
  assert.equal(serialized.includes("BASE64_NOT_LOGGED"), false);
  assert.equal(serialized.includes("sensitive.example"), false);
});

test("polling diagnostics record masked Task ID, status, and progress without Authorization", async () => {
  const captured = [];
  const originalInfo = logging.logger.info;
  let calls = 0;
  logging.logger.info = function capture(message, data) { captured.push({ message, data }); };
  try {
    const provider = new GrsProvider({ modelId: "gpt-image-2" }, { secretStore: secrets(), apiClient: { async requestJson() {
      calls += 1;
      return calls === 1
        ? { id: "official-result-task-123456", status: "running", progress: 58, results: [] }
        : { id: "official-result-task-123456", status: "succeeded", progress: 100, results: [{ url: "https://files.example/final.png" }] };
    } }, pollingManager: { async poll(check) { let result = await check(1); if (!result.done) result = await check(2); return result.value; } } });
    await provider.recoverTask("official-result-task-123456", { modelId: "gpt-image-2", modelFamily: "gpt" });
  } finally { logging.logger.info = originalInfo; }
  const states = captured.filter((item) => item.message === "GRS New API result state").map((item) => item.data);
  assert.equal(states.length, 2);
  assert.deepEqual(states.map((item) => item.status), ["running", "succeeded"]);
  assert.deepEqual(states.map((item) => item.progress), [58, 100]);
  assert.equal(states[0].method, "GET");
  assert.equal(states[0].endpoint, "/v1/api/result");
  assert.equal(states[0].taskId, "offici…3456");
  assert.equal(JSON.stringify(states).toLowerCase().includes("authorization"), false);
  assert.equal(JSON.stringify(states).includes("official-schema-test-key"), false);
});

test("New endpoint metadata distinguishes Nano imageSize from GPT", () => {
  const nano = build("nano-banana-2", { resolutionTier: "2K", imageSize: "2K" });
  const gpt = build("gpt-image-2-vip", { resolutionTier: "2K", imageSize: "2K" });
  assert.deepEqual({ protocol: nano.protocol, modelFamily: nano.modelFamily, method: nano.method, endpoint: nano.endpoint,
    replyType: nano.replyType, aspectRatio: nano.aspectRatio, hasImageSize: nano.hasImageSize, imageSize: nano.imageSize,
    imageCount: nano.imageCount }, { protocol: "new-api", modelFamily: "nano", method: "POST", endpoint: "/v1/api/generate",
    replyType: "async", aspectRatio: "16:9", hasImageSize: true, imageSize: "2K", imageCount: 0 });
  assert.equal(gpt.protocol, "new-api");
  assert.equal(gpt.modelFamily, "gpt");
  assert.equal(gpt.aspectRatio, "2048x1152");
  assert.equal(gpt.hasImageSize, false);
});

test("H2.3 preserves async-first and official timeout constants", () => {
  assert.equal(normalizeGrsConfig().replyType, "async");
  assert.equal(GRS_RESULT_ENDPOINT, "/v1/api/result");
  const source = require("../client/js/network/apiClient").API_TIMEOUTS;
  assert.deepEqual(source, { connection: 25000, generation: 600000, download: 60000 });
});
