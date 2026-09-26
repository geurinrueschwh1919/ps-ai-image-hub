"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { API_TIMEOUTS } = require("../client/js/network/apiClient");
const { PollingManager } = require("../client/js/generation/pollingManager");
const definitions = require("../client/js/providers/asyncTaskDefinition");
const { createGrsNewAsyncDefinition } = require("../client/js/providers/asyncTaskDefinitions");
const { createAliyunBailianAsyncDefinition } = require("../client/js/providers/aliyunBailianDefinition");
const { AsyncTaskProvider } = require("../client/js/providers/asyncTaskProvider");
const { AsyncTaskStore } = require("../client/js/storage/asyncTaskStore");
const { AppError, ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const zhCN = require("../client/js/i18n/zh-CN");

function translator(key, values) {
  var message = zhCN[key] || key;
  Object.keys(values || {}).forEach(function replace(name) {
    message = message.split("{" + name + "}").join(String(values[name]));
  });
  return message;
}

function memoryStorage() {
  var values = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); },
    removeItem(key) { delete values[key]; }
  };
}

test("all current image-task defaults use a 600000 ms total wait budget", () => {
  assert.equal(API_TIMEOUTS.generation, 600000);
  assert.equal(createGrsNewAsyncDefinition().poll.timeoutMs, 600000);
  assert.equal(createAliyunBailianAsyncDefinition().poll.timeoutMs, 600000);
  assert.equal(definitions.normalizeAsyncTaskDefinition({}).poll.timeoutMs, 600000);
});

test("a task still pending after 251 seconds can complete before 600 seconds", async () => {
  var now = 0;
  var manager = new PollingManager({
    now: function currentTime() { return now; },
    wait: function advance() { now += 251000; return Promise.resolve(); }
  });
  var result = await manager.poll(function check(attempt) {
    return Promise.resolve(attempt === 2 ? { done: true, value: "completed" } : { done: false });
  }, { interval: 3000, maxAttempts: 201, timeoutMs: 600000 });
  assert.equal(result, "completed");
  assert.equal(now, 251000);
});

test("600-second timeout shows the safe duplicate-charge warning", async () => {
  var now = 0;
  var manager = new PollingManager({
    now: function currentTime() { return now; },
    wait: function advance() { now += 300000; return Promise.resolve(); }
  });
  await assert.rejects(manager.poll(function pending() {
    return Promise.resolve({ done: false });
  }, { interval: 3000, maxAttempts: 201, timeoutMs: 600000 }), function verify(error) {
    assert.equal(error.code, ErrorCodes.GENERATION_TIMEOUT);
    assert.equal(toUserMessage(error, translator),
      "请求等待超过 10 分钟。任务可能仍在服务器后台处理中，请先检查服务商任务日志，避免立即重复提交导致重复扣费。");
    return true;
  });
});

test("timeout never repeats Submit and Recovery only polls the original Task ID", async () => {
  var now = 0;
  var responses = [
    { id: "original-task", status: "pending" },
    { id: "original-task", status: "pending" },
    { id: "original-task", status: "pending" },
    { id: "original-task", status: "succeeded", output: "https://example.test/result.png" }
  ];
  var calls = [];
  var apiClient = {
    requestJson: function requestJson(url, options) {
      calls.push({ url: url, method: options.method });
      return Promise.resolve(responses.shift());
    }
  };
  var definition = definitions.normalizeAsyncTaskDefinition({
    id: "timeout-patch-test",
    submit: { method: "POST", endpoint: "/submit", requestTimeoutMs: 25000 },
    task: { idPath: "id" },
    poll: { method: "GET", endpointTemplate: "/tasks/{taskId}", intervalMs: 3000,
      timeoutMs: 600000, requestTimeoutMs: 25000, maxAttempts: 201, temporaryFailureRetries: 0 },
    status: { path: "status", pendingValues: ["pending"], successValues: ["succeeded"], failureValues: ["failed"], canceledValues: ["canceled"] },
    result: { path: "output", type: "url" }
  });
  var pollingManager = new PollingManager({
    now: function currentTime() { return now; },
    wait: function advance() { now += 300000; return Promise.resolve(); }
  });
  var taskStore = new AsyncTaskStore({ storage: memoryStorage() });
  var provider = new AsyncTaskProvider({
    id: "timeout-test", displayName: "Timeout Test", type: "async-task", authType: "none",
    baseUrl: "https://example.test", endpointPath: "/submit", modelId: "image-model",
    responsePath: "id", pollingEndpoint: "/tasks/{taskId}", pollingResultPath: "output"
  }, { definition: definition, apiClient: apiClient, asyncTaskStore: taskStore, pollingManager: pollingManager });

  await assert.rejects(provider.generate({ modelId: "image-model", prompt: "test" }), function timedOut(error) {
    return error.code === ErrorCodes.GENERATION_TIMEOUT && error.details.taskId === "original-task";
  });
  assert.equal(calls.filter(function submit(call) { return call.method === "POST"; }).length, 1);
  assert.equal(taskStore.load("original-task").status, "timed_out");

  var recovered = await provider.recoverTask("original-task");
  assert.equal(recovered.status, "succeeded");
  assert.equal(calls.filter(function submit(call) { return call.method === "POST"; }).length, 1);
  assert.match(calls[calls.length - 1].url, /\/tasks\/original-task$/);
});

