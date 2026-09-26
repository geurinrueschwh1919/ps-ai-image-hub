"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../client/js/providers/grsModelCatalog");
const { buildGenerationRequest } = require("../client/js/generation/requestBuilder");
const {
  GrsProvider, normalizeGrsConfig, buildGrsHttpRequest, parseGrsNewApiTaskState,
  GRS_ENDPOINT, GRS_RESULT_ENDPOINT, GRS_CONNECTION_TIMEOUT, GRS_GENERATION_TIMEOUT
} = require("../client/js/providers/grsProvider");
const legacy = require("../client/js/providers/grsLegacyAdapter");
const { ApiClient, API_TIMEOUTS, parseJsonResponseText, sanitizeResponsePreview } = require("../client/js/network/apiClient");
const { ErrorCodes } = require("../client/js/utils/errors");
const { StatusView } = require("../client/js/ui/statusView");
const { CancellationToken } = require("../client/js/generation/cancellationToken");

function secrets() { return { get() { return "test-key-not-real"; } }; }
function request(modelId, extra) {
  return buildGenerationRequest(Object.assign({ providerId: "grs", modelId, prompt: "H2.2 async", aspectRatio: "16:9", resolutionTier: "1K" }, extra || {}));
}
function responseClient(text, contentType, statusText) {
  return new ApiClient({ xhrFactory() {
    return {
      status: 200, statusText: statusText || "OK", responseText: text,
      open() {}, setRequestHeader() {},
      getResponseHeader(name) { return String(name).toLowerCase() === "content-type" ? contentType || "application/json" : ""; },
      send() { this.onload(); }
    };
  } });
}

test("GRS config defaults to async while json and stream remain explicit compatibility modes", () => {
  assert.equal(normalizeGrsConfig().replyType, "async");
  assert.equal(normalizeGrsConfig({ replyType: "json" }).replyType, "json");
  assert.equal(normalizeGrsConfig({ replyType: "stream" }).replyType, "stream");
});

for (const modelId of ["nano-banana-2", "gpt-image-2", "gpt-image-2-vip"]) {
  test(modelId + " defaults New API generation to replyType async", () => {
    const built = buildGrsHttpRequest(request(modelId), normalizeGrsConfig(), "key", catalog.getGrsModel(modelId));
    assert.equal(built.url.endsWith(GRS_ENDPOINT), true);
    assert.equal(JSON.parse(built.body).replyType, "async");
    assert.equal(built.protocol, "new-api");
  });
}

test("explicit json compatibility mode is retained and keeps the long synchronous timeout", async () => {
  let settings;
  const provider = new GrsProvider(null, { secretStore: secrets(), setInterval() { return 1; }, clearInterval() {}, apiClient: {
    async requestJson(url, options) { settings = options; return { id: "json-task", status: "succeeded", results: [{ url: "https://files.example/json.png" }] }; }
  } });
  await provider.generate(request("nano-banana-2", { replyType: "json" }), {});
  assert.equal(settings.timeout, API_TIMEOUTS.generation);
  assert.equal(settings.timeoutContext, "generation");
});

test("default async POST saves Task ID before GET polling and succeeds from top-level results", async () => {
  const calls = [];
  const saves = [];
  let savedBeforePolling = false;
  let pollingOptions;
  const taskStore = { save(value) { saves.push(Object.assign({}, value)); return value; }, load() { return saves[saves.length - 1] || null; } };
  const apiClient = { async requestJson(url, options) {
    calls.push({ url, options });
    if (calls.length === 1) return { id: "async-42", status: "running", progress: 1 };
    if (calls.length === 2) return { id: "async-42", status: "running", progress: 47 };
    return { id: "async-42", status: "succeeded", progress: 100, results: [{ url: "https://files.example/final.png" }] };
  } };
  const pollingManager = { async poll(check, options) {
    pollingOptions = options;
    savedBeforePolling = saves.some((item) => item.id === "async-42" && item.status === "running");
    let result = await check(1);
    if (!result.done) result = await check(2);
    return result.value;
  } };
  const provider = new GrsProvider(null, { secretStore: secrets(), taskStore, apiClient, pollingManager, setInterval() { return 1; }, clearInterval() {} });
  const result = await provider.generate(request("nano-banana-2"), {});
  assert.equal(savedBeforePolling, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.results[0].url, "https://files.example/final.png");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.timeout, GRS_CONNECTION_TIMEOUT);
  assert.equal(JSON.parse(calls[0].options.body).replyType, "async");
  assert.equal(calls[1].options.method, "GET");
  assert.match(calls[1].url, new RegExp(GRS_RESULT_ENDPOINT.replace(/\//g, "\\/") + "\\?id=async-42$"));
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-key-not-real");
  assert.equal(calls[1].options.timeout, GRS_CONNECTION_TIMEOUT);
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(pollingOptions.interval, 3000);
  assert.equal(pollingOptions.timeoutMs, GRS_GENERATION_TIMEOUT);
});

test("running progress is propagated to status observers", async () => {
  const statuses = [];
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { return { id: "p", status: "running", progress: "62" }; } },
    pollingManager: { async poll(check) { await check(1); return { id: "p", status: "succeeded", results: [{ url: "https://files.example/p.png" }] }; } },
    setInterval() { return 1; }, clearInterval() {} });
  await provider.generate(request("nano-banana-2"), { onStatus(status, payload) { statuses.push({ status, payload }); } });
  assert.equal(statuses.some((item) => item.status === "generating" && item.payload && item.payload.progress === 62), true);
});

test("progress remains optional in New API task responses", () => {
  assert.equal(parseGrsNewApiTaskState({ id: "no-progress", status: "running" }).progress, null);
});

test("StatusView displays optional percentage and local-only cancellation wording", () => {
  const element = { setAttribute() {} };
  const translations = { statusGeneratingProgress: "正在生成（{progress}%）", statusCancelled: "已停止本地等待，GRS 服务端任务可能仍在继续。" };
  const t = (key, values) => (translations[key] || key).replace("{progress}", values && values.progress);
  const view = new StatusView(element, t);
  view.update("generating", { progress: 48.4 });
  assert.equal(element.textContent, "正在生成（48%）");
  view.update("cancelled");
  assert.match(element.textContent, /服务端任务可能仍在继续/);
});

for (const status of ["failed", "violation", "cancelled"]) {
  test("New API terminal status " + status + " fails immediately without polling", async () => {
    let polled = false;
    const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { return { id: "bad", status, error: "service rejected" }; } },
      pollingManager: { async poll() { polled = true; } }, setInterval() { return 1; }, clearInterval() {} });
    await assert.rejects(provider.generate(request("nano-banana-2"), {}), (error) => error.code === ErrorCodes.GRS_TASK_FAILED && error.details.status === status);
    assert.equal(polled, false);
  });
}

test("unknown New API status fails as INVALID_RESPONSE_STATUS", async () => {
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { return { id: "odd", status: "mystery" }; } }, setInterval() { return 1; }, clearInterval() {} });
  await assert.rejects(provider.generate(request("nano-banana-2"), {}), (error) => error.code === ErrorCodes.INVALID_RESPONSE_STATUS);
});

test("pending New API response without Task ID gives a recoverability-specific error", async () => {
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { return { status: "running" }; } }, setInterval() { return 1; }, clearInterval() {} });
  await assert.rejects(provider.generate(request("nano-banana-2"), {}), (error) => error.code === ErrorCodes.TASK_ID_UNAVAILABLE);
});

test("New API parser reads only top-level status/results and never unwraps legacy data", () => {
  assert.equal(parseGrsNewApiTaskState({ data: { id: "legacy", status: "succeeded", results: [] } }).status, null);
});

test("Legacy adapter stays POST/data-scoped and is never used by New API result requests", () => {
  const built = legacy.buildGrsLegacyResultRequest("https://legacy.example", "legacy-id", "key");
  assert.equal(built.method, "POST");
  assert.equal(built.url, "https://legacy.example/v1/draw/result");
  assert.equal(built.protocol, "legacy-api");
  assert.equal(legacy.parseGrsLegacyResult({ code: 0, data: { id: "legacy-id", status: "succeeded", results: [] } }).id, "legacy-id");
  assert.throws(() => legacy.parseGrsLegacyResult({ id: "new-id", status: "succeeded", results: [] }), (error) => error.code === ErrorCodes.INVALID_RESPONSE);
});

test("Legacy GPT generate remains /v1/draw/completions with urls[] and no images[]", () => {
  const built = legacy.buildGrsLegacyGenerationRequest({ modelId: "gpt-image-2", prompt: "legacy", aspectRatio: "1:1",
    references: [{ url: "https://input.example/a.png" }] }, { baseUrl: "https://legacy.example" }, "key", catalog.getGrsModel("gpt-image-2"));
  const body = JSON.parse(built.body);
  assert.equal(built.url, "https://legacy.example/v1/draw/completions");
  assert.deepEqual(body.urls, ["https://input.example/a.png"]);
  assert.equal(Object.hasOwn(body, "images"), false);
});

test("a pre-cancelled recovery token stops local polling without a server cancel request", async () => {
  const token = new CancellationToken();
  token.cancel();
  let networkCalls = 0;
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson() { networkCalls += 1; } } });
  await assert.rejects(provider.recoverTask("local-cancel", { cancellationToken: token }), (error) => error.code === ErrorCodes.CANCELLED);
  assert.equal(networkCalls, 0);
});

test("JSON parser trims a UTF-8 BOM", () => assert.equal(parseJsonResponseText("\uFEFF  {\"id\":\"bom\",\"status\":\"running\"}" ).id, "bom"));
test("empty HTTP 200 response has EMPTY_RESPONSE", () => assert.throws(() => parseJsonResponseText("  "), (error) => error.code === ErrorCodes.EMPTY_RESPONSE));
test("HTML HTTP 200 response has UPSTREAM_HTML_RESPONSE", () => assert.throws(() => parseJsonResponseText("<!doctype html><html></html>", { contentType: "text/html" }), (error) => error.code === ErrorCodes.UPSTREAM_HTML_RESPONSE));
test("plain text HTTP 200 response has NON_JSON_TEXT_RESPONSE", () => assert.throws(() => parseJsonResponseText("upstream unavailable"), (error) => error.code === ErrorCodes.NON_JSON_TEXT_RESPONSE));
test("malformed JSON HTTP 200 response has INVALID_RESPONSE", () => assert.throws(() => parseJsonResponseText("{\"id\":"), (error) => error.code === ErrorCodes.INVALID_RESPONSE));
test("SSE compatibility parser extracts a valid JSON data event", () => assert.equal(parseJsonResponseText("event: task\ndata: {\"id\":\"sse\",\"status\":\"running\"}\n", { contentType: "text/event-stream" }).id, "sse"));
test("unusable stream has UNEXPECTED_STREAM_RESPONSE", () => assert.throws(() => parseJsonResponseText("event: task\ndata: not-json", { contentType: "text/event-stream" }), (error) => error.code === ErrorCodes.UNEXPECTED_STREAM_RESPONSE));
test("nonstandard wrapper can recover an embedded valid task object", () => assert.equal(parseJsonResponseText("notice => {\"id\":\"embedded\",\"status\":\"running\"} <= end", { allowEmbeddedJson: true }).id, "embedded"));
test("strict quoted task envelope fallback safely recovers id/status", () => assert.equal(parseJsonResponseText("trace \"id\":\"safe-1\" and \"status\":\"running\"", { allowTaskEnvelope: true }).id, "safe-1"));
test("nonstandard unquoted task envelope safely recovers id/status", () => assert.deepEqual(parseJsonResponseText("{ id: task-2, status: running }", { allowTaskEnvelope: true }), { id: "task-2", status: "running", _recoveredFromText: true }));
test("valid JSON with surrounding whitespace remains valid", () => assert.equal(parseJsonResponseText(" \r\n {\"id\":\"space\",\"status\":\"running\"} \t").id, "space"));

test("manual recovery performs only authenticated GET result requests", async () => {
  const calls = [];
  const provider = new GrsProvider(null, { secretStore: secrets(), apiClient: { async requestJson(url, options) {
    calls.push({ url, options }); return { id: "recover-only", status: "succeeded", results: [{ url: "https://files.example/recovered.png" }] };
  } }, pollingManager: { async poll(check) { return (await check(1)).value; } } });
  const response = await provider.recoverTask("recover-only", { modelId: "nano-banana-2" });
  assert.equal(response.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key-not-real");
});

test("HTTP 200 diagnostics expose bounded sanitized metadata before parsing", async () => {
  let diagnostics;
  const base64 = "A".repeat(180);
  const client = responseClient(JSON.stringify({ id: "diag", status: "succeeded", url: "https://secret.example/a?token=abc", image: base64 }), "application/json; charset=utf-8", "OK");
  await client.requestJson("https://api.example/generate", { timeout: 25000, onResponseDiagnostics(value) { diagnostics = value; } });
  assert.equal(diagnostics.httpStatus, 200);
  assert.equal(diagnostics.statusText, "OK");
  assert.equal(diagnostics.contentType, "application/json; charset=utf-8");
  assert.ok(diagnostics.responseLength > 180);
  assert.ok(diagnostics.responsePreview.length <= 300);
  assert.equal(diagnostics.responsePreview.includes("secret.example"), false);
  assert.equal(diagnostics.responsePreview.includes(base64), false);
});

test("response preview redacts Bearer tokens, API keys, URLs, and large encoded data", () => {
  const preview = sanitizeResponsePreview("Bearer secret-token apiKey=test-key-not-real sk-abcdefgh12345678 https://files.example/private " + "B".repeat(160));
  assert.equal(preview.includes("secret-token"), false);
  assert.equal(preview.includes("test-key-not-real"), false);
  assert.equal(preview.includes("sk-abcdefgh"), false);
  assert.equal(preview.includes("files.example"), false);
  assert.equal(preview.includes("B".repeat(120)), false);
});

test("Main Panel explicitly selects async only for GRS", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /providerSelect\.value === "grs" \? "async" : "json"/);
});

test("H2.2 keeps official timeout budgets and GPT resolution mapping intact", () => {
  assert.deepEqual(API_TIMEOUTS, { connection: 25000, generation: 600000, download: 60000 });
  assert.equal(catalog.resolveGptVipPixelSize("16:9", "4K"), "3840x2160");
  assert.deepEqual(catalog.getGrsModel("gpt-image-2").resolutionTiers, ["1K"]);
});

test("Nano keeps imageSize while GPT New API never receives Nano imageSize", () => {
  const nano = JSON.parse(buildGrsHttpRequest(request("nano-banana-2", { resolutionTier: "2K" }), normalizeGrsConfig(), "key", catalog.getGrsModel("nano-banana-2")).body);
  const gpt = JSON.parse(buildGrsHttpRequest(request("gpt-image-2-vip", { resolutionTier: "2K" }), normalizeGrsConfig(), "key", catalog.getGrsModel("gpt-image-2-vip")).body);
  assert.equal(nano.imageSize, "2K");
  assert.equal(Object.hasOwn(gpt, "imageSize"), false);
});
