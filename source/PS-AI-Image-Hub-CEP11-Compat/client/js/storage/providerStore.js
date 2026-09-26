(function defineProviderStore(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createProviderStore(root) {
  "use strict";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.providers.v1";
  var SECRET_KEYS = /api[-_]?key|authorization|bearer|token|secret/i;

  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).reduce(function reduce(result, key) {
      if (!SECRET_KEYS.test(key)) result[key] = sanitize(value[key]);
      return result;
    }, {});
  }

  class ProviderStore {
    constructor(options) {
      this.storage = options && options.storage || root.localStorage;
    }
    load() {
      try {
        var value = this.storage.getItem(STORAGE_KEY);
        return value ? JSON.parse(value) : [];
      } catch (error) { return []; }
    }
    save(providerConfigs) {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(sanitize(providerConfigs || [])));
    }
  }

  return { ProviderStore: ProviderStore, PROVIDER_STORAGE_KEY: STORAGE_KEY, sanitizeProviderConfig: sanitize };
}));

