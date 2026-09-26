(function defineOpenAICompatibleProvider(root, factory) {
  "use strict";
  var base = typeof module === "object" && module.exports ? require("./baseProvider") : root.PSAIImageHubCompat;
  var configs = typeof module === "object" && module.exports ? require("./providerConfig") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var api = factory(base, configs, builders, errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createOpenAICompatibleProvider(base, configs, builders, errors) {
  "use strict";
  class OpenAICompatibleProvider extends base.BaseProvider {
    constructor(config, dependencies) {
      var normalized = configs.normalizeProviderConfig(config);
      super({ id: normalized.id, displayName: normalized.displayName, type: normalized.type,
        models: normalized.models,
        capabilities: { supportsTextToImage: true, supportsAspectRatio: true, supportsCustomModels: true } });
      this.config = normalized;
      this.apiClient = dependencies.apiClient;
      this.secretStore = dependencies.secretStore;
    }
    secretName() { return "provider:" + this.id + ":apiKey"; }
    apiKey() { return this.secretStore.get(this.secretName()); }
    validateConfig() { return configs.validateProviderConfig(this.config, this.config.authType === "none" || !!this.apiKey()); }
    testConnection() {
      configs.requireValidProviderConfig(this.config, this.config.authType === "none" || !!this.apiKey());
      return Promise.resolve({ ok: true, mode: "configuration-only" });
    }
    async generate(request) {
      configs.requireValidProviderConfig(this.config, this.config.authType === "none" || !!this.apiKey());
      var httpRequest = builders.buildOpenAICompatibleHttpRequest(request, this.config, this.apiKey());
      return this.apiClient.requestJson(httpRequest.url, httpRequest);
    }
    extractImages(response) {
      if (!response || !Array.isArray(response.data)) throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE_FORMAT, "OpenAI-compatible response does not contain a data array.");
      var images = response.data.map(function map(item, index) {
        if (item && item.b64_json) return { id: "api-" + index, mimeType: "image/png", previewSource: "data:image/png;base64," + item.b64_json, importSource: { type: "base64", data: item.b64_json, mimeType: "image/png" }, rawResponseMeta: { created: response.created || null } };
        if (item && item.url) return { id: "api-" + index, mimeType: "image/png", previewSource: item.url, importSource: { type: "url", url: item.url }, rawResponseMeta: { created: response.created || null } };
        return null;
      }).filter(Boolean);
      if (!images.length) throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE_FORMAT, "OpenAI-compatible response contains no image URL or Base64 payload.");
      return images;
    }
  }
  return { OpenAICompatibleProvider: OpenAICompatibleProvider };
}));
