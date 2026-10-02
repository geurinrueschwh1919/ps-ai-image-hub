(function defineGenericRestProvider(root, factory) {
  "use strict";
  var base = typeof module === "object" && module.exports ? require("./baseProvider") : root.PSAIImageHubCompat;
  var configs = typeof module === "object" && module.exports ? require("./providerConfig") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var paths = typeof module === "object" && module.exports ? require("../utils/objectPath") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var api = factory(base, configs, builders, paths, errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGenericRestProvider(base, configs, builders, paths, errors) {
  "use strict";
  class GenericRestProvider extends base.BaseProvider {
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
      var httpRequest = builders.buildGenericRestHttpRequest(request, this.config, this.apiKey());
      return this.apiClient.requestJson(httpRequest.url, httpRequest);
    }
    extractImages(response) {
      var value = paths.getByPath(response, this.config.responsePath);
      if (value === undefined || value === null || value === "") throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE_FORMAT, "Configured response path did not resolve to an image.");
      var values = Array.isArray(value) ? value : [value];
      var type = this.config.resultType;
      if (type === "auto") type = typeof values[0] === "string" && /^https?:\/\//i.test(values[0]) ? "url" : "base64";
      if (type !== "url" && type !== "base64") throw new errors.AppError(errors.ErrorCodes.UNSUPPORTED_RESULT_FORMAT, "Generic REST result type is unsupported.");
      return values.map(function map(item, index) {
        if (typeof item !== "string") throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE_FORMAT, "Image result must be a string.");
        if (type === "url") return { id: "generic-" + index, mimeType: null, previewSource: item, importSource: { type: "url", url: item }, rawResponseMeta: { responsePath: this.config.responsePath } };
        var dataUrl = /^data:/i.test(item) ? item : "data:image/png;base64," + item;
        return { id: "generic-" + index, mimeType: "image/png", previewSource: dataUrl, importSource: { type: "base64", data: item, mimeType: "image/png" }, rawResponseMeta: { responsePath: this.config.responsePath } };
      }, this);
    }
  }
  return { GenericRestProvider: GenericRestProvider };
}));
