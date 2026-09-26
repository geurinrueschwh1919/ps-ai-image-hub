"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiClient, API_TIMEOUTS } = require("../client/js/network/apiClient");
const { GrsProvider, buildGrsHttpRequest, normalizeGrsConfig } = require("../client/js/providers/grsProvider");
const { getGrsModel } = require("../client/js/providers/grsModelCatalog");
const { buildGenerationRequest } = require("../client/js/generation/requestBuilder");
const { ReferenceImageManager } = require("../client/js/photoshop/referenceImageManager");
const { bytesToBase64 } = require("../client/js/utils/base64");
const { ErrorCodes } = require("../client/js/utils/errors");

function png(width, height, byteLength) {
  const value = Buffer.alloc(Math.max(24, byteLength || 24));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
  value.writeUInt32BE(width, 16); value.writeUInt32BE(height, 20);
  return value;
}

function image(id, value) { return { id, mimeType: "image/png", apiValue: value, base64: value, width: 128, height: 128 }; }

function virtualXhr(observations, delayMs) {
  return function createXhr() {
    const xhr = {
      status: 0, responseText: "", timeout: 0, headers: {},
      open(method, url) { observations.method = method; observations.url = url; },
      setRequestHeader(name, value) { this.headers[name] = value; },
      send(body) {
        observations.sendCalled = true; observations.body = body; observations.timeout = this.timeout;
        queueMicrotask(() => {
          if (delayMs > this.timeout) { this.ontimeout(); return; }
          this.status = 200; this.responseText = JSON.stringify({ id: "h1-task", status: "succeeded", progress: 100, results: [{ url: "https://files.example/h1.png" }] }); this.onload();
        });
      },
      abort() { if (this.onabort) this.onabort(); }
    };
    observations.xhr = xhr; return xhr;
  };
}

function provider(observations, delayMs, extras) {
  return new GrsProvider(null, Object.assign({
    apiClient: new ApiClient({ timeout: 25000, xhrFactory: virtualXhr(observations, delayMs || 1) }),
    secretStore: { get() { return "sk-h1-test-not-real"; } }, setInterval() { return 1; }, clearInterval() {}
  }, extras || {}));
}

function generationInput(mainImage, referenceImages) {
  return buildGenerationRequest({ providerId: "grs", modelId: "nano-banana-2", prompt: "H1 image pipeline", aspectRatio: "1:1", imageSize: "1K", replyType: "json", imageInputs: { mainImage: mainImage || null, referenceImages: referenceImages || [] } });
}

test("128x128 Main Image reaches xhr.send through GRS New API", async () => {
  const observations = {}, main = image("main", png(128, 128).toString("base64"));
  await provider(observations).generate(generationInput(main, []));
  assert.equal(observations.sendCalled, true); assert.equal(JSON.parse(observations.body).images.length, 1);
});

test("128x128 Reference Image reaches xhr.send through GRS New API", async () => {
  const observations = {}, reference = image("reference", png(128, 128).toString("base64"));
  await provider(observations).generate(generationInput(null, [reference]));
  assert.equal(observations.sendCalled, true); assert.deepEqual(JSON.parse(observations.body).images, [reference.apiValue]);
});

test("Main plus Reference produces two ordered New API images", async () => {
  const observations = {}, main = image("main", "TUFJTg=="), reference = image("reference", "UkVG");
  await provider(observations).generate(generationInput(main, [reference]));
  assert.deepEqual(JSON.parse(observations.body).images, ["TUFJTg==", "UkVG"]); assert.equal(observations.sendCalled, true);
});

test("Main plus two References preserves order and calls xhr.send", async () => {
  const observations = {}, request = generationInput(image("main", "TUFJTg=="), [image("r1", "UkVGMQ=="), image("r2", "UkVGMg==")]);
  await provider(observations).generate(request);
  assert.deepEqual(JSON.parse(observations.body).images, ["TUFJTg==", "UkVGMQ==", "UkVGMg=="]); assert.equal(observations.sendCalled, true);
});

test("GRS New API strips a Data URL prefix and sends raw Base64", () => {
  const request = generationInput(image("main", "data:image/png;base64,QUJD"), []);
  const built = buildGrsHttpRequest(request, normalizeGrsConfig(), "key", getGrsModel("nano-banana-2"));
  assert.deepEqual(JSON.parse(built.body).images, ["QUJD"]);
});

test("2560x1440 native CEP Base64 read and decode completes without apply/spread", () => {
  const large = png(2560, 1440, 3 * 1024 * 1024);
  const manager = new ReferenceImageManager({ photoshopBridge: {}, cepFs: { readFile() { return { err: 0, data: large.toString("base64") }; } }, base64Encoding: "base64" });
  const result = manager.readReference("large.png", { sourceType: "local-file" });
  assert.equal(result.width, 2560); assert.equal(result.height, 1440); assert.equal(result.base64.length, large.toString("base64").length);
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/utils/base64.js"), "utf8");
  assert.doesNotMatch(source, /fromCharCode\.apply|\.\.\.\s*bytes|\.\.\.\s*uint8/i);
});

test("two 2560x1440 image fixtures serialize and reach xhr.send with payloadBytes", async () => {
  const large = png(2560, 1440, 3 * 1024 * 1024).toString("base64");
  const observations = {}, request = generationInput(image("main", large), [image("reference", large)]);
  await provider(observations).generate(request);
  const built = buildGrsHttpRequest(request, normalizeGrsConfig(), "key", getGrsModel("nano-banana-2"));
  assert.equal(observations.sendCalled, true); assert.equal(JSON.parse(observations.body).images.length, 2);
  assert.equal(built.payloadBytes, Buffer.byteLength(built.body, "utf8")); assert.ok(built.payloadBytes > 8 * 1024 * 1024);
});

test("image pipeline diagnostics expose sizes but never Base64 or API Key", async () => {
  const captured = [], originalLog = console.log;
  console.log = function capture() { captured.push(Array.from(arguments)); };
  try { await provider({}).generate(generationInput(image("main", "U0VDUkVUX0JBU0U2NA=="), [])); }
  finally { console.log = originalLog; }
  const output = JSON.stringify(captured);
  assert.match(output, /REQUEST_BODY_READY/); assert.match(output, /XHR_SEND_ENTERED/); assert.match(output, /XHR_REQUEST_STARTED/); assert.match(output, /payloadBytes/);
  assert.equal(output.includes("U0VDUkVUX0JBU0U2NA=="), false); assert.equal(output.includes("sk-h1-test-not-real"), false);
});

test("reference file read failure exposes REFERENCE_FILE_READ_FAILED stage", () => {
  const manager = new ReferenceImageManager({ photoshopBridge: {}, cepFs: { readFile() { return { err: 2 }; } }, base64Encoding: "base64" });
  assert.throws(() => manager.readReference("missing.png"), (error) => error.code === ErrorCodes.REFERENCE_FILE_READ_FAILED && error.details.stage === "referenceRead");
});

test("request serialization failure exposes REQUEST_SERIALIZE_FAILED", () => {
  const request = generationInput(null, []); request.prompt = 1n;
  assert.throws(() => buildGrsHttpRequest(request, normalizeGrsConfig(), "key", getGrsModel("nano-banana-2")), (error) => error.code === ErrorCodes.REQUEST_SERIALIZE_FAILED && error.details.stage === "requestSerialize");
});

test("native xhr.send failure exposes XHR_SEND_FAILED and xhrSend stage", async () => {
  const instance = new GrsProvider(null, { secretStore: { get() { return "key"; } }, setInterval() { return 1; }, clearInterval() {}, apiClient: new ApiClient({ xhrFactory() { return { open() {}, setRequestHeader() {}, send() { throw new Error("payload rejected before transport"); } }; } }) });
  await assert.rejects(instance.generate(generationInput(image("main", "QUJD"), [])), (error) => error.code === ErrorCodes.XHR_SEND_FAILED && error.details.stage === "xhrSend" && error.details.payloadBytes > 0);
});

for (const seconds of [179, 181, 420, 599]) {
  test(seconds + " second GRS response succeeds inside the 10-minute window", async () => {
    const observations = {}; const result = await provider(observations, seconds * 1000).generate(generationInput(null, []));
    assert.equal(result.status, "succeeded"); assert.equal(observations.timeout, 600000);
  });
}

test("601 second GRS response produces GENERATION_TIMEOUT", async () => {
  const observations = {};
  await assert.rejects(provider(observations, 601000).generate(generationInput(null, [])), (error) => error.code === ErrorCodes.GENERATION_TIMEOUT && error.details.effectiveTimeoutMs === 600000);
});

test("connection timeout remains 25000ms instead of inheriting generation budget", async () => {
  const observations = {}, client = new ApiClient({ timeout: 600000, xhrFactory: virtualXhr(observations, 26000) });
  await assert.rejects(client.requestJson("https://example.test/query", { timeout: API_TIMEOUTS.connection, timeoutContext: "connection" }), (error) => error.code === ErrorCodes.NETWORK_CONNECTION_TIMEOUT && error.details.effectiveTimeoutMs === 25000);
});

test("recovery polling keeps a 600000ms total window and short individual queries", async () => {
  let pollOptions;
  const instance = provider({}, 1, { pollingManager: { async poll(check, options) { pollOptions = options; return { id: "task", status: "succeeded", results: [{ url: "https://files.example/h1.png" }] }; } } });
  await instance.recoverTask("task", { modelId: "nano-banana-2" });
  assert.equal(pollOptions.timeoutMs, 600000); assert.equal(pollOptions.maxAttempts, 201); assert.equal(API_TIMEOUTS.connection, 25000);
});

test("waiting notices remain 30-second steps and stop at 600 seconds", async () => {
  let tick; const waits = [];
  const instance = new GrsProvider(null, { secretStore: { get() { return "key"; } }, setInterval(callback) { tick = callback; return 1; }, clearInterval() {}, apiClient: { async requestJson(url, options) { options.onRequestStarted(); for (let i = 0; i < 22; i += 1) tick(); return { id: "done", status: "succeeded", results: [{ url: "https://files.example/h1.png" }] }; } } });
  await instance.generate(generationInput(null, []), { onStatus(status, payload) { if (status === "waiting") waits.push(payload.seconds); } });
  assert.equal(waits[0], 30); assert.equal(waits.at(-1), 600); assert.equal(waits.length, 20);
});
