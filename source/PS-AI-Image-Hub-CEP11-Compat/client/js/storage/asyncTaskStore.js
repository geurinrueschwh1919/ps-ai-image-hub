(function defineAsyncTaskStore(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAsyncTaskStore(root) {
  "use strict";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.async-tasks.v1";
  var MAX_TASKS = 20;
  var SECRET_KEYS = /api[-_]?key|authorization|bearer|token|secret|base64|apiValue|requestBody|submitResponse/i;

  function safeCopy(value, depth) {
    if (depth > 6) return null;
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.slice(0, 2000);
    if (Array.isArray(value)) return value.slice(0, 20).map(function copy(item) { return safeCopy(item, depth + 1); });
    if (typeof value !== "object") return undefined;
    return Object.keys(value).reduce(function reduce(result, key) {
      if (!SECRET_KEYS.test(key)) result[key] = safeCopy(value[key], depth + 1);
      return result;
    }, {});
  }

  function safeTask(task) {
    var source = task || {};
    function safeUrl(value) {
      return String(value || "").replace(/([?&](?:api[_-]?key|access[_-]?token|token|authorization)=)[^&#]*/gi, "$1[REDACTED]").slice(0, 2000);
    }
    return {
      schemaVersion: Number(source.schemaVersion) || 1,
      definitionVersion: Number(source.definitionVersion) || 1,
      id: String(source.id || source.taskId || ""),
      taskId: String(source.id || source.taskId || ""),
      executionId: String(source.executionId || ""),
      historyId: String(source.historyId || ""),
      providerId: String(source.providerId || ""),
      protocolId: String(source.protocolId || ""),
      definitionId: String(source.definitionId || ""),
      status: String(source.status || "task_created"),
      modelId: String(source.modelId || ""),
      prompt: String(source.prompt || "").slice(0, 4000),
      pollUrl: safeUrl(source.pollUrl),
      cancelUrl: safeUrl(source.cancelUrl),
      createdAt: String(source.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString(),
      requestConfiguration: safeCopy(source.requestConfiguration || {}, 0),
      recoveryData: safeCopy(source.recoveryData || {}, 0)
    };
  }

  class AsyncTaskStore {
    constructor(options) { this.storage = options && options.storage || root.localStorage; }
    all() {
      if (!this.storage) return [];
      try {
        var parsed = JSON.parse(this.storage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter(function valid(item) { return item && item.id; }) : [];
      } catch (error) { return []; }
    }
    save(task) {
      if (!this.storage || !task || !(task.id || task.taskId)) return null;
      var safe = safeTask(task);
      var tasks = this.all().filter(function different(item) {
        return !(item.id === safe.id && item.providerId === safe.providerId && item.definitionId === safe.definitionId);
      });
      tasks.unshift(safe);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
      return safe;
    }
    load(taskId, providerId, definitionId) {
      var id = String(taskId || "");
      return this.all().find(function match(item) {
        return item.id === id && (!providerId || item.providerId === providerId) && (!definitionId || item.definitionId === definitionId);
      }) || null;
    }
    latest(providerId, definitionId) {
      return this.all().find(function match(item) {
        return (!providerId || item.providerId === providerId) && (!definitionId || item.definitionId === definitionId);
      }) || null;
    }
    clear(taskId) {
      if (!this.storage) return;
      if (!taskId) { this.storage.removeItem(STORAGE_KEY); return; }
      var id = String(taskId);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.all().filter(function keep(item) { return item.id !== id; })));
    }
  }

  return {
    AsyncTaskStore: AsyncTaskStore,
    ASYNC_TASK_STORAGE_KEY: STORAGE_KEY,
    sanitizeAsyncRecoveryTask: safeTask
  };
}));
