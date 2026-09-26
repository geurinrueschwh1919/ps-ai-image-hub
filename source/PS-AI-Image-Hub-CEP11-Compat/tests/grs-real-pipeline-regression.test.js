"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiClient } = require("../client/js/network/apiClient");
const { GrsProvider, createSafeTimerApi } = require("../client/js/providers/grsProvider");
const { ResponseExtractor } = require("../client/js/generation/responseExtractor");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { ErrorCodes } = require("../client/js/utils/errors");
const { AppError, toUserMessage } = require("../client/js/utils/errors");
const { createTranslator } = require("../client/js/i18n");

function virtualTimedXhr(scenario, observations) {
  return function createXhr() {
    const xhr = {
      status: 0, responseText: "", timeout: 0, sent: false, headers: {},
      open(method, url) { observations.method = method; observations.url = url; },
      setRequestHeader(name, value) { this.headers[name] = value; },
      getResponseHeader() { return scenario.contentType || "application/json"; },
      abort() { if (this.onabort) this.onabort(); },
      send(body) {
        this.sent = true; observations.body = body; observations.effectiveTimeoutMs = this.timeout;
        queueMicrotask(() => {
          if (scenario.delayMs > this.timeout) { this.ontimeout(); return; }
          this.status = scenario.status;
          this.responseText = typeof scenario.body === "string" ? scenario.body : JSON.stringify(scenario.body);
          this.onload();
        });
      }
    };
    observations.xhr = xhr;
    return xhr;
  };
}

function createProvider(scenario, observations, extras) {
  const client = new ApiClient({ timeout: 25000, xhrFactory: virtualTimedXhr(scenario, observations) });
  return new GrsProvider(null, Object.assign({
    apiClient: client,
    secretStore: { get() { return "regression-test-placeholder"; } },
    setInterval() { return 1; }, clearInterval() {}
  }, extras || {}));
}

function request() {
  return { modelId: "nano-banana-2", prompt: "A red apple on a white background.", aspectRatio: "1:1", imageSize: "1K", replyType: "json", references: [] };
}

test("Illegal invocation regression: native timer methods keep their owning runtime context", () => {
  const calls = [];
  const fakeRuntime = {
    setInterval(callback, delay) {
      if (this !== fakeRuntime) throw new TypeError("Illegal invocation");
      calls.push(["start", delay]);
      return 17;
    },
    clearInterval(timerId) {
      if (this !== fakeRuntime) throw new TypeError("Illegal invocation");
      calls.push(["stop", timerId]);
    }
  };
  const timerApi = createSafeTimerApi(fakeRuntime, {});
  const timerId = timerApi.startInterval(() => {}, 30000);
  timerApi.stopInterval(timerId);
  assert.deepEqual(calls, [["start", 30000], ["stop", 17]]);
});

test("XHR native send and getResponseHeader methods keep the XMLHttpRequest receiver", async () => {
  const observations = {};
  const ownerCheckedXhr = {
    status: 200,
    responseText: '{"ok":true}',
    response: new ArrayBuffer(8),
    open() { if (this !== ownerCheckedXhr) throw new TypeError("Illegal invocation"); },
    setRequestHeader() { if (this !== ownerCheckedXhr) throw new TypeError("Illegal invocation"); },
    send() {
      if (this !== ownerCheckedXhr) throw new TypeError("Illegal invocation");
      observations.sent = true;
      this.onload();
    },
    getResponseHeader() {
      if (this !== ownerCheckedXhr) throw new TypeError("Illegal invocation");
      observations.headerRead = true;
      return "image/png";
    }
  };
  const client = new ApiClient({ xhrFactory: () => ownerCheckedXhr });
  const downloaded = await client.requestArrayBuffer("https://files.example/result.png");
  assert.equal(observations.sent, true);
  assert.equal(observations.headerRead, true);
  assert.equal(downloaded.mimeType, "image/png");
});

test("Scenario A: virtual 80-second GRS succeeded response is not cut off by the 25-second ApiClient default", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 80000, status: 200, body: { id: "task-80", status: "succeeded", progress: 100, results: [{ url: "https://files.example/a.png" }] } }, observations,
    { pollingManager: { poll() { throw new Error("Synchronous succeeded response must not poll."); } } });
  const response = await provider.generate(request());
  assert.equal(response.status, "succeeded");
  assert.equal(observations.effectiveTimeoutMs, 600000);
  assert.equal(observations.xhr.timeout, 600000);
  assert.equal(observations.xhr.sent, true);
});

test("Scenario B: virtual 601-second GRS request produces GENERATION_TIMEOUT", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 601000, status: 200, body: {} }, observations);
  await assert.rejects(provider.generate(request()), (error) => {
    assert.equal(error.code, ErrorCodes.GENERATION_TIMEOUT);
    assert.equal(error.details.effectiveTimeoutMs, 600000);
    assert.equal(error.details.provider, "GRS");
    return true;
  });
});

test("Scenario C: virtual 10-second HTTP 400 preserves the real service message and diagnostics", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 10000, status: 400, body: { error: { message: "Model is unavailable for this account" } } }, observations);
  await assert.rejects(provider.generate(request()), (error) => {
    assert.equal(error.code, ErrorCodes.HTTP_ERROR);
    assert.equal(error.details.status, 400);
    assert.equal(error.details.serviceMessage, "Model is unavailable for this account");
    assert.equal(error.details.effectiveTimeoutMs, 600000);
    assert.equal(error.details.endpoint, "/v1/api/generate");
    return true;
  });
});

test("Scenario D: virtual one-second succeeded/results URL completes response extraction", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 1000, status: 200, body: { id: "task-1", status: "succeeded", progress: 100, results: [{ url: "https://files.example/result.png" }] } }, observations);
  const raw = await provider.generate(request());
  const extracted = await new ResponseExtractor().extract(provider, raw);
  assert.equal(extracted.images[0].previewSource, "https://files.example/result.png");
  assert.equal(extracted.images[0].importSource.type, "url");
});

test("Scenario E: Mock Provider remains independent of ApiClient/XHR changes", async () => {
  const provider = new MockProvider({ submitDelay: 0, generationDelay: 0 });
  const raw = await provider.generate({ modelId: "mock-image-v1", prompt: "regression" });
  const extracted = await new ResponseExtractor().extract(provider, raw);
  assert.equal(extracted.images[0].importSource.type, "plugin-asset");
});

test("an observer exception after xhr.send cannot reject or prevent a real request", async () => {
  const observations = {};
  const client = new ApiClient({ timeout: 25000, xhrFactory: virtualTimedXhr({ delayMs: 1000, status: 200, body: { ok: true } }, observations) });
  const result = await client.requestJson("https://example.test/generate", { timeout: 600000, onRequestStarted() { throw new Error("UI observer failure"); } });
  assert.equal(result.ok, true);
  assert.equal(observations.xhr.sent, true);
  assert.equal(observations.effectiveTimeoutMs, 600000);
});

test("a GRS UI status observer exception cannot stop the POST request", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 1000, status: 200, body: { id: "t", status: "succeeded", results: [{ url: "https://files.example/a.png" }] } }, observations);
  const result = await provider.generate(request(), { onStatus() { throw new Error("CEF UI callback regression"); } });
  assert.equal(result.status, "succeeded");
  assert.equal(observations.xhr.sent, true);
});

test("a GenerationManager-style status observer cannot break response parsing", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 1000, status: 200, body: { id: "t", status: "succeeded", results: [{ url: "https://files.example/a.png" }] } }, observations);
  const result = await provider.generate(request(), { onTask() { throw new Error("task observer failed"); } });
  assert.equal(result.status, "succeeded");
  assert.equal(observations.xhr.sent, true);
});

test("GRS user-visible failure contains stage, code, HTTP status, timeout, Provider, Model and Endpoint", () => {
  const error = new AppError(ErrorCodes.HTTP_ERROR, "HTTP request failed with status 400.", {
    stage: "request", status: 400, serviceMessage: "Invalid request field", effectiveTimeoutMs: 600000,
    provider: "GRS", model: "nano-banana-2", endpoint: "/v1/api/generate"
  });
  const message = toUserMessage(error, createTranslator("zh-CN"));
  ["阶段：", "HTTP_ERROR", "400", "Invalid request field", "600000", "GRS", "nano-banana-2", "/v1/api/generate"].forEach((value) => assert.match(message, new RegExp(value)));
});

test("GRS json request preserves URL, Bearer, Content-Type and official POST body", async () => {
  const observations = {};
  const provider = createProvider({ delayMs: 1000, status: 200, body: { id: "t", status: "succeeded", results: [{ url: "https://files.example/a.png" }] } }, observations);
  await provider.generate(request());
  const body = JSON.parse(observations.body);
  assert.equal(observations.method, "POST");
  assert.equal(observations.url, "https://grsaiapi.com/v1/api/generate");
  assert.match(observations.xhr.headers.Authorization, /^Bearer /);
  assert.equal(observations.xhr.headers["Content-Type"], "application/json");
  assert.equal(body.replyType, "json");
  assert.equal(body.model, "nano-banana-2");
});

test("only a pending GRS json state hands control to recovery polling", async () => {
  const observations = {}; let pollingCalled = false;
  const provider = createProvider({ delayMs: 1000, status: 200, body: { id: "pending-task", status: "processing", progress: 10, results: [] } }, observations, {
    pollingManager: { async poll(check) { pollingCalled = true; return { id: "pending-task", status: "succeeded", progress: 100, results: [{ url: "https://files.example/final.png" }] }; } }
  });
  const result = await provider.generate(request());
  assert.equal(pollingCalled, true);
  assert.equal(result.status, "succeeded");
});
