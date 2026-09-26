(function defineUiStateStore(root, factory) {
  "use strict";
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(root, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createUiStateStore(root, logging) {
  "use strict";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.ui-preferences.v1";

  class UiStateStore {
    constructor(options) {
      var settings = options || {};
      this.providerManager = settings.providerManager || null;
      this.storage = settings.storage || root.localStorage;
      this.listeners = [];
      this.modelUpdateInProgress = false;
      this.preferences = this.loadPreferences();
    }
    loadPreferences() {
      try {
        var parsed = JSON.parse(this.storage && this.storage.getItem(STORAGE_KEY) || "null");
        return { matchMainSize: Boolean(parsed && parsed.matchMainSize === true),
          selectionPromptConstraint: !parsed || parsed.selectionPromptConstraint !== false };
      } catch (error) { return { matchMainSize: false, selectionPromptConstraint: true }; }
    }
    savePreferences() {
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify({ matchMainSize: this.preferences.matchMainSize === true,
        selectionPromptConstraint: this.preferences.selectionPromptConstraint !== false }));
    }
    getModel(providerId) {
      var config = this.providerManager && this.providerManager.getProviderConfig(providerId);
      return config && config.modelId || "";
    }
    setModel(providerId, modelId, origin) {
      var previous = this.getModel(providerId);
      if (!providerId || !modelId || previous === modelId) return modelId;
      if (this.modelUpdateInProgress) return previous;
      this.modelUpdateInProgress = true;
      try {
        this.providerManager.setSelectedModel(providerId, modelId);
        logging.logger.info("MODEL_STATE_CHANGED", { provider: providerId, model: modelId, origin: origin || "ui" });
        this.emit({ type: "model", providerId: providerId, modelId: modelId, origin: origin || "ui" });
        return modelId;
      } finally { this.modelUpdateInProgress = false; }
    }
    getMatchMainSize() { return this.preferences.matchMainSize === true; }
    setMatchMainSize(enabled, origin) {
      var value = enabled === true;
      if (value === this.preferences.matchMainSize) return value;
      this.preferences.matchMainSize = value;
      this.savePreferences();
      this.emit({ type: "matchMainSize", value: value, origin: origin || "ui" });
      return value;
    }
    getSelectionPromptConstraint() { return this.preferences.selectionPromptConstraint !== false; }
    setSelectionPromptConstraint(enabled, origin) {
      var value = enabled !== false;
      if (value === this.preferences.selectionPromptConstraint) return value;
      this.preferences.selectionPromptConstraint = value; this.savePreferences();
      this.emit({ type: "selectionPromptConstraint", value: value, origin: origin || "ui" });
      return value;
    }
    subscribe(listener) {
      if (typeof listener !== "function") return function noop() {};
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(function keep(item) { return item !== listener; }); };
    }
    emit(change) {
      this.listeners.slice().forEach(function notify(listener) { try { listener(change); } catch (error) { /* UI isolation */ } });
    }
  }

  return { UiStateStore: UiStateStore, UI_PREFERENCES_STORAGE_KEY: STORAGE_KEY };
}));
