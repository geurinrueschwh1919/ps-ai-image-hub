(function defineGrsTaskStore(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGrsTaskStore(root) {
  "use strict";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.grs.last-task.v1";

  class GrsTaskStore {
    constructor(options) { this.storage = options && options.storage || root.localStorage; }
    save(task) {
      if (!this.storage || !task || !task.id) return null;
      var safe = {
        id: String(task.id), status: String(task.status || "running"), progress: Number(task.progress || 0),
        node: String(task.node || "global"), baseUrl: String(task.baseUrl || ""),
        modelId: String(task.modelId || ""), executionId: String(task.executionId || ""),
        historyId: String(task.historyId || ""), updatedAt: new Date().toISOString()
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(safe));
      return safe;
    }
    load() {
      if (!this.storage) return null;
      try {
        var value = JSON.parse(this.storage.getItem(STORAGE_KEY) || "null");
        return value && value.id ? value : null;
      } catch (error) { return null; }
    }
    clear() { if (this.storage) this.storage.removeItem(STORAGE_KEY); }
  }

  return { GrsTaskStore: GrsTaskStore, GRS_TASK_STORAGE_KEY: STORAGE_KEY };
}));
