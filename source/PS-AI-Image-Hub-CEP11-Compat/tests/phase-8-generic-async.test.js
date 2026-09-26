"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const definitions = require("../client/js/providers/asyncTaskDefinition");
const protocolDefinitions = require("../client/js/providers/asyncTaskDefinitions");
const { AsyncTaskProvider, mapAsyncHttpError } = require("../client/js/providers/asyncTaskProvider");
const { AsyncTaskStore, ASYNC_TASK_STORAGE_KEY } = require("../client/js/storage/asyncTaskStore");
const { PollingManager } = require("../client/js/generation/pollingManager");
const { CancellationToken } = require("../client/js/generation/cancellationToken");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");
const { createNetworkSafetyGuard } = require("./helpers/networkSafetyGuard");

const FIXTURES = path.resolve(__dirname, "fixtures/phase8");
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8")); }
function memoryStorage() {
  const values = new Map();
  return { values, getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}
function secretStore(value) { return { get() { return value || null; } }; }
function config(overrides) {
  return Object.assign({ id: "async-test", displayName: "Async Test", type: "async-task",
    baseUrl: "https://example.test", endpointPath: "/submit", modelId: "model-version-test",
    authType: "bearer", responsePath: "id", pollingEndpoint: "/tasks/{taskId}", pollingResultPath: "output" }, overrides || {});
}
function instantPolling(options) {
  const settings = options || {};
  return new PollingManager({ now: settings.now || (() => Date.now()), wait: settings.wait || (() => Promise.resolve()) });
}
function providerWith(definition, responses, options) {
  const settings = options || {};
  const apiClient = settings.apiClient || createNetworkSafetyGuard(responses);
  const storage = settings.storage || memoryStorage();
  const taskStore = settings.taskStore || new AsyncTaskStore({ storage });
  const provider = new AsyncTaskProvider(config(settings.config), {
    definition, apiClient, secretStore: secretStore(settings.token || "test-token"),
    pollingManager: settings.pollingManager || instantPolling(), asyncTaskStore: taskStore
  });
  return { provider, apiClient, taskStore, storage };
}

test("path resolver reads id", () => assert.equal(definitions.resolveAsyncPath({ id: "x" }, "id"), "x"));
test("path resolver reads data.id", () => assert.equal(definitions.resolveAsyncPath({ data: { id: "x" } }, "data.id"), "x"));
test("path resolver reads urls.get", () => assert.equal(definitions.resolveAsyncPath({ urls: { get: "u" } }, "urls.get"), "u"));
test("path resolver returns undefined for a missing path", () => assert.equal(definitions.resolveAsyncPath({}, "data.id"), undefined));
test("path resolver returns undefined for a null response", () => assert.equal(definitions.resolveAsyncPath(null, "id"), undefined));
test("path resolver reads a deeply nested object", () => assert.equal(definitions.resolveAsyncPath({ a: { b: { c: 4 } } }, "a.b.c"), 4));

test("AsyncTaskDefinition validates independent submit, poll, status, result, and cancel sections", () => {
  const result = definitions.validateAsyncTaskDefinition(protocolDefinitions.createReplicatePredictionsDefinition());
  assert.equal(result.valid, true); assert.equal(result.definition.executionMode, "async");
  assert.deepEqual(result.definition.status.pendingValues, ["starting", "processing"]);
});

test("successful submit extracts Task ID and immediately persists safe recovery metadata", async () => {
  const replicate = protocolDefinitions.createReplicatePredictionsDefinition();
  const setup = providerWith(replicate, [fixture("replicate-submit-starting")]);
  const task = await setup.provider.submit({ modelId: "version-test", prompt: "draw" });
  assert.equal(task.id, "pred_test_001"); assert.equal(setup.taskStore.load(task.id).id, task.id);
  const raw = setup.storage.values.get(ASYNC_TASK_STORAGE_KEY);
  assert.doesNotMatch(raw, /test-token|Authorization|Bearer|submitResponse/);
});

test("missing Task ID returns INVALID_RESPONSE with ASYNC_TASK_ID_MISSING reason", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [{ status: "starting", urls: {} }]);
  await assert.rejects(setup.provider.submit({ modelId: "v", prompt: "p" }),
    (error) => error.code === ErrorCodes.INVALID_RESPONSE && error.details.reason === "ASYNC_TASK_ID_MISSING");
});

test("malformed submit response is rejected before polling", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [null]);
  await assert.rejects(setup.provider.submit({ modelId: "v", prompt: "p" }), (error) => error.code === ErrorCodes.INVALID_RESPONSE);
  assert.equal(setup.apiClient.calls.length, 1);
});

test("HTTP 401 and 403 map to AUTH_ERROR", () => {
  [401, 403].forEach((status) => {
    const mapped = mapAsyncHttpError(new AppError(ErrorCodes.HTTP_CLIENT, "denied", { status }), "submit");
    assert.equal(mapped.code, ErrorCodes.AUTH_ERROR);
  });
});

test("HTTP 404, 408, 429 and 5xx preserve actionable async error codes", () => {
  assert.equal(mapAsyncHttpError(new AppError(ErrorCodes.HTTP_CLIENT, "x", { status: 404 }), "poll").code, ErrorCodes.TASK_NOT_FOUND);
  assert.equal(mapAsyncHttpError(new AppError(ErrorCodes.HTTP_CLIENT, "x", { status: 408 }), "poll").code, ErrorCodes.REQUEST_TIMEOUT);
  assert.equal(mapAsyncHttpError(new AppError(ErrorCodes.HTTP_CLIENT, "x", { status: 429 }), "poll").code, ErrorCodes.RATE_LIMITED);
  assert.equal(mapAsyncHttpError(new AppError(ErrorCodes.HTTP_SERVER, "x", { status: 503 }), "poll").code, ErrorCodes.REMOTE_SERVER_ERROR);
});

test("submit HTTP failure never creates fake recovery metadata or starts polling", async () => {
  const storage = memoryStorage();
  const failure = new AppError(ErrorCodes.HTTP_SERVER, "down", { status: 503 });
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [failure], { storage });
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }), (error) => error.code === ErrorCodes.REMOTE_SERVER_ERROR);
  assert.equal(setup.taskStore.all().length, 0); assert.equal(setup.apiClient.calls.length, 1);
});

test("status mapping supports one and multiple pending values", () => {
  const grs = protocolDefinitions.createGrsNewAsyncDefinition();
  const replicate = protocolDefinitions.createReplicatePredictionsDefinition();
  assert.equal(definitions.classifyAsyncStatus(grs, fixture("grs-running")).kind, "pending");
  assert.equal(definitions.classifyAsyncStatus(replicate, fixture("replicate-submit-starting")).kind, "pending");
  assert.equal(definitions.classifyAsyncStatus(replicate, fixture("replicate-processing")).kind, "pending");
});

test("status mapping distinguishes success, failure, canceled, and unknown", () => {
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  assert.equal(definitions.classifyAsyncStatus(definition, fixture("replicate-succeeded-string")).kind, "success");
  assert.equal(definitions.classifyAsyncStatus(definition, fixture("replicate-failed")).kind, "failure");
  assert.equal(definitions.classifyAsyncStatus(definition, fixture("replicate-canceled")).kind, "canceled");
  assert.equal(definitions.classifyAsyncStatus(definition, { status: "queued_new_state" }).kind, "unknown");
});

test("Replicate pending then success uses dynamic urls.get", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [
    fixture("replicate-submit-starting"), fixture("replicate-processing"), fixture("replicate-succeeded-string")
  ]);
  const response = await setup.provider.generate({ modelId: "version-test", prompt: "draw" });
  assert.equal(response.status, "succeeded");
  assert.equal(setup.apiClient.calls[1].url, "https://api.replicate.com/v1/predictions/pred_test_001");
  assert.equal(setup.apiClient.calls[2].url, "https://api.replicate.com/v1/predictions/pred_test_001");
});

test("multiple pending cycles terminate at success without infinite polling", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [
    fixture("replicate-submit-starting"), fixture("replicate-processing"), fixture("replicate-processing"), fixture("replicate-succeeded-string")
  ]);
  await setup.provider.generate({ modelId: "v", prompt: "p" });
  assert.equal(setup.apiClient.calls.length, 4);
});

test("remote failure exposes a readable service error", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting"), fixture("replicate-failed")]);
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }),
    (error) => error.code === ErrorCodes.ASYNC_TASK_FAILED && error.message === "mock failure");
});

test("remote canceled status is distinct from local cancellation", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting"), fixture("replicate-canceled")]);
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }), (error) => error.code === ErrorCodes.ASYNC_REMOTE_CANCELED);
});

test("repeated unknown status stops with INVALID_RESPONSE_STATUS", async () => {
  const definition = protocolDefinitions.createReplicatePredictionsDefinition(); definition.poll.unknownStatusLimit = 2;
  const setup = providerWith(definition, [fixture("replicate-submit-starting"), { status: "new" }, { status: "new" }]);
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }),
    (error) => error.code === ErrorCodes.INVALID_RESPONSE_STATUS && error.details.reason === "ASYNC_UNKNOWN_STATUS");
});

test("temporary 503 polling failure retries and retains Task ID", async () => {
  const temporary = new AppError(ErrorCodes.HTTP_SERVER, "temporary", { status: 503 });
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [
    fixture("replicate-submit-starting"), temporary, fixture("replicate-processing"), fixture("replicate-succeeded-string")
  ]);
  const result = await setup.provider.generate({ modelId: "v", prompt: "p" });
  assert.equal(result.status, "succeeded"); assert.equal(setup.taskStore.load("pred_test_001").id, "pred_test_001");
});

test("per-request timeout maps to REQUEST_TIMEOUT and can be retried", async () => {
  const timeout = new AppError(ErrorCodes.NETWORK_TIMEOUT, "timeout", { effectiveTimeoutMs: 25000 });
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [
    fixture("replicate-submit-starting"), timeout, fixture("replicate-succeeded-string")
  ]);
  assert.equal((await setup.provider.generate({ modelId: "v", prompt: "p" })).status, "succeeded");
});

test("overall timeout stops polling but preserves recoverable Task ID", async () => {
  let now = 0;
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  definition.poll.intervalMs = 10; definition.poll.timeoutMs = 25; definition.poll.maxAttempts = 20;
  const pollingManager = instantPolling({ now: () => now, wait: (ms) => { now += ms; return Promise.resolve(); } });
  const setup = providerWith(definition, [fixture("replicate-submit-starting"), fixture("replicate-processing"), fixture("replicate-processing"), fixture("replicate-processing")], { pollingManager });
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }),
    (error) => error.code === ErrorCodes.GENERATION_TIMEOUT && error.details.taskId === "pred_test_001" && error.details.canRecover === true);
  assert.equal(setup.taskStore.load("pred_test_001").status, "timed_out");
});

test("cancellation signal stops active polling before another query", async () => {
  const token = new CancellationToken();
  const definition = protocolDefinitions.createReplicatePredictionsDefinition(); definition.poll.intervalMs = 1;
  const pollingManager = instantPolling({ wait: () => { token.cancel(); return Promise.resolve(); } });
  const setup = providerWith(definition, [fixture("replicate-submit-starting"), fixture("replicate-processing")], { pollingManager });
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }, { cancellationToken: token }),
    (error) => error.code === ErrorCodes.CANCELLED && error.details.localOnly === true);
  assert.equal(setup.apiClient.calls.length, 2); assert.equal(setup.taskStore.load("pred_test_001").status, "canceled_local");
});

test("URL string result normalizes to one URL", () => {
  const result = definitions.extractAsyncResult(protocolDefinitions.createReplicatePredictionsDefinition(), fixture("replicate-succeeded-string"));
  assert.deepEqual(result.urls, ["https://example.test/result.png"]); assert.deepEqual(result.base64, []);
});

test("URL array result preserves order", () => {
  const result = definitions.extractAsyncResult(protocolDefinitions.createReplicatePredictionsDefinition(), fixture("replicate-succeeded-array"));
  assert.deepEqual(result.urls, ["https://example.test/result-1.png", "https://example.test/result-2.png"]);
});

test("nested URL objects normalize without provider-name logic", () => {
  const definition = definitions.normalizeAsyncTaskDefinition({ id: "nested", submit: { endpoint: "/s" }, task: { idPath: "id" },
    poll: { endpoint: "/p" }, status: {}, result: { path: "data.results" } });
  const result = definitions.extractAsyncResult(definition, { data: { results: [{ url: "https://example.test/a.png" }] } });
  assert.deepEqual(result.urls, ["https://example.test/a.png"]);
});

test("Base64 string and array results normalize separately from URLs", () => {
  const definition = definitions.normalizeAsyncTaskDefinition({ id: "b64", submit: { endpoint: "/s" }, task: { idPath: "id" }, poll: { endpoint: "/p" },
    status: {}, result: { path: "output", type: "base64" } });
  assert.deepEqual(definitions.extractAsyncResult(definition, { output: "QUJD" }).base64, ["QUJD"]);
  assert.deepEqual(definitions.extractAsyncResult(definition, { output: ["QUJD", "REVG"] }).base64, ["QUJD", "REVG"]);
});

test("provider-specific result extractor can normalize a complex object", () => {
  const definition = definitions.normalizeAsyncTaskDefinition({ id: "complex", submit: { endpoint: "/s" }, task: { idPath: "id" }, poll: { endpoint: "/p" }, status: {},
    result: { path: "payload", extractor(value) { return { urls: [value.primary.location], base64: [], raw: value }; } } });
  assert.deepEqual(definitions.extractAsyncResult(definition, { payload: { primary: { location: "https://example.test/x.png" } } }).urls,
    ["https://example.test/x.png"]);
});

test("empty and malformed results do not become fake images", () => {
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  assert.deepEqual(definitions.extractAsyncResult(definition, { output: null }).urls, []);
  assert.deepEqual(definitions.extractAsyncResult(definition, { output: 12 }).base64, []);
});

test("successful terminal status with an empty result fails as NO_IMAGES", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting"),
    { id: "pred_test_001", status: "succeeded", output: null, error: null }]);
  await assert.rejects(setup.provider.generate({ modelId: "v", prompt: "p" }), (error) => error.code === ErrorCodes.NO_IMAGES);
});

test("error objects are safely stringified instead of [object Object]", () => {
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  assert.equal(definitions.extractAsyncErrorMessage(definition, { error: { code: "bad", reason: "no" } }), '{"code":"bad","reason":"no"}');
});

test("local cancel stops polling and does not claim server cancellation", async () => {
  const setup = providerWith(protocolDefinitions.createGrsNewAsyncDefinition(), [fixture("grs-submit")], { config: { baseUrl: "https://example.test" } });
  const task = await setup.provider.submit({ modelId: "m", prompt: "p" });
  const token = new CancellationToken();
  const result = await setup.provider.cancel(task, { cancellationToken: token, remote: false });
  assert.equal(token.cancelled, true); assert.equal(result.canceledLocally, true); assert.equal(result.canceledRemotely, false); assert.equal(result.serverMayContinue, true);
});

test("Replicate remote cancel uses dynamic urls.cancel", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting"), { id: "pred_test_001", status: "canceled" }]);
  const task = await setup.provider.submit({ modelId: "v", prompt: "p" });
  const result = await setup.provider.cancel(task, { remote: true });
  assert.equal(result.canceledRemotely, true);
  assert.equal(setup.apiClient.calls[1].url, "https://api.replicate.com/v1/predictions/pred_test_001/cancel");
  assert.equal(setup.apiClient.calls[1].method, "POST");
});

test("remote cancel HTTP failure degrades to local cancellation", async () => {
  const failure = new AppError(ErrorCodes.HTTP_SERVER, "down", { status: 503 });
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting"), failure]);
  const task = await setup.provider.submit({ modelId: "v", prompt: "p" });
  const result = await setup.provider.cancel(task, { remote: true });
  assert.equal(result.canceledLocally, true); assert.equal(result.remoteCancelFailed, true); assert.equal(result.serverMayContinue, true);
});

test("Provider without cancel endpoint remains local-only", async () => {
  const setup = providerWith(protocolDefinitions.createGrsNewAsyncDefinition(), [fixture("grs-submit")]);
  const task = await setup.provider.submit({ modelId: "m", prompt: "p" });
  const result = await setup.provider.cancel(task, { remote: true });
  assert.equal(result.canceledRemotely, false); assert.equal(setup.apiClient.calls.length, 1);
});

test("recovery uses saved Task ID and never repeats submit POST", async () => {
  const storage = memoryStorage();
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  const first = providerWith(definition, [fixture("replicate-submit-starting")], { storage });
  await first.provider.submit({ modelId: "v", prompt: "p" });
  const reopenedApi = createNetworkSafetyGuard([fixture("replicate-succeeded-string")]);
  const reopened = providerWith(definition, [], { storage, apiClient: reopenedApi });
  const result = await reopened.provider.recoverTask("pred_test_001");
  assert.equal(result.status, "succeeded"); assert.equal(reopenedApi.calls.length, 1);
  assert.equal(reopenedApi.calls[0].method, "GET");
});

test("recovery continues when image snapshot metadata is missing", async () => {
  const definition = protocolDefinitions.createGrsNewAsyncDefinition();
  const apiClient = createNetworkSafetyGuard([fixture("grs-succeeded")]);
  const setup = providerWith(definition, [], { apiClient });
  const result = await setup.provider.recoverTask({ schemaVersion: 1, definitionVersion: 1, id: "grs_test_001",
    providerId: "async-test", protocolId: "new-api", definitionId: definition.id, status: "running" });
  assert.equal(result.status, "succeeded"); assert.equal(apiClient.calls[0].method, "GET");
});

test("unsupported recovery schema fails clearly", async () => {
  const definition = protocolDefinitions.createReplicatePredictionsDefinition();
  const setup = providerWith(definition, []);
  await assert.rejects(setup.provider.recoverTask({ schemaVersion: 2, definitionVersion: 1, id: "pred_test_001",
    providerId: "async-test", definitionId: definition.id }), (error) => error.code === ErrorCodes.RECOVERY_SCHEMA_UNSUPPORTED);
});

test("GRS definition maps ID, GET query, running, success, failure, and violation", async () => {
  const definition = protocolDefinitions.createGrsNewAsyncDefinition();
  const setup = providerWith(definition, [fixture("grs-submit"), fixture("grs-running"), fixture("grs-succeeded")]);
  const response = await setup.provider.generate({ modelId: "nano-banana-2", prompt: "p" });
  assert.equal(response.status, "succeeded");
  assert.equal(setup.apiClient.calls[1].url, "https://example.test/v1/api/result?id=grs_test_001");
  assert.equal(definitions.classifyAsyncStatus(definition, fixture("grs-failed")).kind, "failure");
  assert.equal(definitions.classifyAsyncStatus(definition, fixture("grs-violation")).kind, "failure");
  assert.deepEqual(definitions.extractAsyncResult(definition, response).urls, ["https://example.test/grs-result.png"]);
});

test("Replicate submit body and auth are documented async shape without Prefer wait", async () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), [fixture("replicate-submit-starting")]);
  await setup.provider.submit({ modelId: "MODEL_VERSION_ID", prompt: "hello" });
  const call = setup.apiClient.calls[0];
  assert.equal(call.url, "https://example.test/v1/predictions");
  assert.deepEqual(JSON.parse(call.body), { version: "MODEL_VERSION_ID", input: { prompt: "hello" } });
  assert.equal(call.headers.Authorization, "Bearer test-token"); assert.equal(call.headers.Prefer, undefined);
});

test("Replicate output string and array both become provider-neutral image records", () => {
  const setup = providerWith(protocolDefinitions.createReplicatePredictionsDefinition(), []);
  assert.equal(setup.provider.extractImages(setup.provider.parseResponse(fixture("replicate-succeeded-string"))).length, 1);
  assert.equal(setup.provider.extractImages(setup.provider.parseResponse(fixture("replicate-succeeded-array"))).length, 2);
});

test("core AsyncTaskProvider has no GRS or Replicate name branching", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/providers/asyncTaskProvider.js"), "utf8");
  assert.doesNotMatch(source, /provider\s*===?\s*["'](?:grs|replicate)|switch\s*\(\s*provider(?:Name|Id)?/i);
});

test("fixtures contain fake IDs only and no credential-shaped token", () => {
  const source = fs.readdirSync(FIXTURES).map((name) => fs.readFileSync(path.join(FIXTURES, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /Bearer\s+|REPLICATE_API_TOKEN|\bsk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}/i);
  assert.match(source, /pred_test_001/); assert.match(source, /grs_test_001/);
});

test("network safety guard blocks real paid endpoints without an explicit fixture", async () => {
  const guard = createNetworkSafetyGuard([]);
  await assert.rejects(guard.requestJson("https://api.replicate.com/v1/predictions", { method: "POST" }),
    (error) => error.code === "NETWORK_CALL_NOT_ALLOWED_IN_TEST");
  await assert.rejects(guard.requestJson("https://grsaiapi.com/v1/api/generate", { method: "POST" }),
    (error) => error.code === "NETWORK_CALL_NOT_ALLOWED_IN_TEST");
});

test("Async task recovery metadata never persists API Key, Bearer header, or Base64", () => {
  const storage = memoryStorage(), store = new AsyncTaskStore({ storage });
  store.save({ id: "t", providerId: "p", definitionId: "d", apiKey: "real-secret", authorization: "Bearer real-secret",
    recoveryData: { apiValue: "LONGBASE64", mainTarget: { width: 10 } }, requestConfiguration: { aspectRatio: "1:1" } });
  const raw = storage.values.get(ASYNC_TASK_STORAGE_KEY);
  assert.doesNotMatch(raw, /real-secret|LONGBASE64|authorization|apiValue/i); assert.match(raw, /aspectRatio/);
});
