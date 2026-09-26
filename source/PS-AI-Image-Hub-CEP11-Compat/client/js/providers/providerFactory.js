(function defineProviderFactory(root, factory) {
  "use strict";
  var dependencies = typeof module === "object" && module.exports ? {
    OpenAICompatibleProvider: require("./openAICompatibleProvider").OpenAICompatibleProvider,
    GenericRestProvider: require("./genericRestProvider").GenericRestProvider,
    AsyncTaskProvider: require("./asyncTaskProvider").AsyncTaskProvider,
    AliyunBailianProvider: require("./aliyunBailianProvider").AliyunBailianProvider,
    GrsProvider: require("./grsProvider").GrsProvider,
    errors: require("../utils/errors")
  } : { root: root };
  var api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createProviderFactory(dependencies) {
  "use strict";
  class ProviderFactory {
    constructor(dependencies) { this.dependencies = dependencies; }
    create(config) {
      var hub = dependencies.root ? dependencies.root.PSAIImageHubCompat : dependencies;
      if (config.type === "openai-compatible") return new hub.OpenAICompatibleProvider(config, this.dependencies);
      if (config.type === "generic-rest") return new hub.GenericRestProvider(config, this.dependencies);
      if (config.type === "async-task") return new hub.AsyncTaskProvider(config, this.dependencies);
      if (config.type === "aliyun-bailian") return new hub.AliyunBailianProvider(config, this.dependencies);
      if (config.type === "grs") return new hub.GrsProvider(config, this.dependencies);
      var errorApi = hub.errors || hub;
      throw new errorApi.AppError(errorApi.ErrorCodes.INVALID_PROVIDER_CONFIG, "Unsupported provider type: " + config.type);
    }
  }
  return { ProviderFactory: ProviderFactory };
}));
