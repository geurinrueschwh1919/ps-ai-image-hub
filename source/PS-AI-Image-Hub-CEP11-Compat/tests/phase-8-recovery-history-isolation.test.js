"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { HistoryStore } = require("../client/js/storage/historyStore");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");
const { logger } = require("../client/js/utils/logger");

function memoryFs() {
  const files = new Map();
  return {
    files,
    makedir() { return { err: 0 }; },
    stat(path) { return files.has(path) ? { err: 0 } : { err: 1 }; },
    readFile(path) { return files.has(path) ? { err: 0, data: files.get(path) } : { err: 1 }; },
    writeFile(path, data) { files.set(path, data); return { err: 0 }; },
    deleteFile(path) { files.delete(path); return { err: 0 }; }
  };
}

function taskStore() {
  const tasks = new Map();
  return {
    save(task) { const value = JSON.parse(JSON.stringify(task)); tasks.set(String(value.id), value); return value; },
    load(id) { return JSON.parse(JSON.stringify(tasks.get(String(id)) || null)); }
  };
}

function history() {
  return new HistoryStore({
    rootPath: "C:\\UserData", cepFs: memoryFs(), apiClient: {}, maxHistoryCount: 50,
    photoshopBridge: { getUserDataRoot() { return "C:\\UserData"; }, resolveExtensionAsset(path) { return path; } }
  });
}

function image(id) {
  return { id, mimeType: "image/png", previewSource: "https://example.test/" + id + ".png", importSource: null };
}

function provider(store) {
  return {
    id: "async-test", config: { modelId: "model-1" }, taskStore: store,
    getModels() { return [{ id: "model-1" }]; },
    validateConfig() { return { valid: true }; },
    generateImpl: null, recoverImpl: null,
    generate(request, options) { return this.generateImpl(request, options); },
    recoverTask(id, options) { return this.recoverImpl(id, options); }
  };
}

function managerFor(flowProvider, historyStore, importer) {
  return new GenerationManager({
    providerManager: {
      requireProvider(id) { assert.equal(id, "async-test"); return flowProvider; },
      getProvider() { return flowProvider; }
    },
    historyStore,
    imageImporter: importer || { async importImages() { return { imported: true, layers: ["AI"] }; } },
    responseExtractor: { async extract(unused, raw) { return { images: raw.images || [] }; } },
    t(key) { return key; }
  });
}

function input(overrides) {
  return Object.assign({
    providerId: "async-test", modelId: "model-1", prompt: "snapshot prompt", aspectRatio: "16:9",
    imageSize: "1K", imageInputs: { mainImage: null, referenceImages: [] }, autoImport: false
  }, overrides || {});
}

async function cancelOriginal(manager, flowProvider) {
  flowProvider.generateImpl = function waitForCancel(request, options) {
    options.onTask({ id: "task-A", status: "running", modelId: request.modelId });
    return new Promise((resolve, reject) => options.cancellationToken.subscribe(() => {
      reject(new AppError(ErrorCodes.CANCELLED, "Local wait stopped.", { taskId: "task-A" }));
    }));
  };
  const pending = manager.generateOneClick(input(), {});
  await Promise.resolve();
  assert.equal(manager.cancelGeneration(), true);
  await assert.rejects(pending, (error) => error.code === ErrorCodes.CANCELLED);
}

test("local cancel then recovery success updates original execution History instead of adding failure", async () => {
  const tasks = taskStore(), records = history(), flow = provider(tasks), manager = managerFor(flow, records);
  await cancelOriginal(manager, flow);
  const saved = tasks.load("task-A");
  const canceled = records.findByExecution(saved.executionId);
  assert.equal(canceled.status, "canceled-local");
  flow.recoverImpl = async function recover(id, options) {
    assert.equal(id, "task-A");
    options.onTask({ id, status: "succeeded" });
    return { images: [image("A")] };
  };
  const result = await manager.recoverProviderTask("async-test", "task-A", {
    executionId: saved.executionId, historyId: saved.historyId, modelId: "model-1", prompt: "snapshot prompt", autoImport: true
  });
  const entries = records.load();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, saved.historyId);
  assert.equal(entries[0].executionId, saved.executionId);
  assert.equal(entries[0].taskId, "task-A");
  assert.equal(entries[0].status, "succeeded");
  assert.equal(entries[0].importStatus, "imported");
  assert.equal(result.importState, "imported");
});

test("snapshot regeneration creates a new execution, Task ID, and History entry", async () => {
  const tasks = taskStore(), records = history(), flow = provider(tasks), manager = managerFor(flow, records);
  await cancelOriginal(manager, flow);
  const original = tasks.load("task-A");
  let submittedRequest;
  flow.generateImpl = async function regenerate(request, options) {
    submittedRequest = request;
    options.onTask({ id: "task-B", status: "succeeded", modelId: request.modelId });
    return { images: [image("B")] };
  };
  const regenerated = await manager.generateOneClick(input({ snapshotSourceExecutionId: original.executionId }), {});
  const taskB = tasks.load("task-B");
  assert.notEqual(taskB.id, original.id);
  assert.notEqual(taskB.executionId, original.executionId);
  assert.notEqual(taskB.historyId, original.historyId);
  assert.equal(submittedRequest.prompt, "snapshot prompt");
  assert.equal(submittedRequest.aspectRatio, "16:9");
  assert.equal(regenerated.taskId, "task-B");
  const entries = records.load();
  assert.equal(entries.length, 2);
  assert.equal(records.findByExecution(taskB.executionId).status, "succeeded");
  assert.equal(records.findByExecution(original.executionId).status, "canceled-local");
});

test("recovery A and snapshot regeneration B can complete concurrently without cross-write", async () => {
  const tasks = taskStore(), records = history(), flow = provider(tasks), manager = managerFor(flow, records);
  const original = { executionId: "exec-A", historyId: "history-A", taskId: "task-A", status: "canceled-local" };
  records.beginExecution(input(), original);
  records.writeExecutionStatus(original, { status: "canceled-local", taskId: "task-A" });
  tasks.save(Object.assign({ id: "task-A", modelId: "model-1" }, original));
  let finishRecovery;
  flow.recoverImpl = function recover(id, options) {
    return new Promise((resolve) => { finishRecovery = () => { options.onTask({ id, status: "succeeded" }); resolve({ images: [image("A")] }); }; });
  };
  flow.generateImpl = async function regenerate(request, options) {
    options.onTask({ id: "task-B", status: "succeeded", modelId: request.modelId });
    return { images: [image("B")] };
  };
  const recovery = manager.recoverProviderTask("async-test", "task-A", Object.assign({ modelId: "model-1" }, original));
  await Promise.resolve();
  const regeneration = manager.generateOneClick(input({ snapshotSourceExecutionId: "exec-A" }), {});
  await regeneration;
  finishRecovery();
  await recovery;
  const taskB = tasks.load("task-B");
  assert.equal(records.findByExecution("exec-A").status, "succeeded");
  assert.equal(records.findByExecution(taskB.executionId).status, "succeeded");
  assert.notEqual(taskB.historyId, "history-A");
});

test("stale callback cannot write another execution History and is diagnosed", () => {
  const records = history();
  const a = { executionId: "exec-A", historyId: "history-A" };
  const b = { executionId: "exec-B", historyId: "history-B" };
  records.beginExecution(input(), a);
  records.beginExecution(input(), b);
  records.writeExecutionStatus(b, { status: "succeeded" });
  const warnings = [];
  const previous = logger.warn;
  logger.warn = (message) => warnings.push(message);
  try {
    assert.equal(records.writeExecutionStatus({ executionId: a.executionId, historyId: b.historyId }, { status: "failed" }), false);
  } finally { logger.warn = previous; }
  assert.equal(records.findByExecution(b.executionId).status, "succeeded");
  assert.ok(warnings.includes("STALE_ASYNC_CALLBACK_IGNORED"));
});

test("confirmed remote cancellation is terminal and cannot become fake success", async () => {
  const records = history();
  const owner = { executionId: "exec-remote", historyId: "history-remote", taskId: "task-remote" };
  records.beginExecution(input(), owner);
  records.recordFailure(input(), new AppError(ErrorCodes.ASYNC_REMOTE_CANCELED, "Remote canceled."), owner);
  await records.recordSuccess(input(), { providerId: "async-test", modelId: "model-1", taskId: "task-remote", images: [image("remote")], importState: "notImported" }, owner);
  assert.equal(records.findByExecution(owner.executionId).status, "canceled-remote");
});

test("successful import is stored as generation success and imported", async () => {
  const tasks = taskStore(), records = history(), flow = provider(tasks), manager = managerFor(flow, records);
  flow.generateImpl = async function success(request, options) {
    options.onTask({ id: "task-import", status: "succeeded" });
    return { images: [image("imported")] };
  };
  const result = await manager.generateOneClick(input({ autoImport: true }), {});
  const entry = records.findByExecution(result.executionId);
  assert.equal(entry.status, "succeeded");
  assert.equal(entry.generationStatus, "succeeded");
  assert.equal(entry.importStatus, "imported");
});

test("import failure does not rewrite remote generation success as failed", async () => {
  const tasks = taskStore(), records = history(), flow = provider(tasks);
  const manager = managerFor(flow, records, { async importImages() { throw new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "Import failed."); } });
  flow.generateImpl = async function success(request, options) {
    options.onTask({ id: "task-import-fail", status: "succeeded" });
    return { images: [image("import-fail")] };
  };
  const result = await manager.generateOneClick(input({ autoImport: true }), {});
  const entry = records.findByExecution(result.executionId);
  assert.equal(entry.status, "succeeded");
  assert.equal(entry.generationStatus, "succeeded");
  assert.equal(entry.importStatus, "failed");
  assert.equal(result.importState, "failed");
});

test("task and History persistence clone data instead of sharing mutable objects", () => {
  const records = history();
  const owner = { executionId: "exec-clone", historyId: "history-clone", taskId: "task-clone" };
  const entry = records.beginExecution(input(), owner);
  entry.status = "failed";
  owner.taskId = "mutated";
  const stored = records.findByExecution("exec-clone");
  assert.equal(stored.status, "submitting");
  assert.equal(stored.taskId, "task-clone");
});

