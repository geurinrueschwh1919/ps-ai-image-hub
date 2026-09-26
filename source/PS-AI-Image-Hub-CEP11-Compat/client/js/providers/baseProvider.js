(function defineBaseProvider(root, factory) {
  "use strict";
  var dependencies = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createBaseProvider(dependencies) {
  "use strict";
  var AppError = dependencies.AppError;
  var ErrorCodes = dependencies.ErrorCodes;

  class BaseProvider {
    constructor(definition) {
      if (!definition || !definition.id || !definition.displayName) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER, "Provider definition is incomplete.");
      }
      this.id = definition.id;
      this.displayName = definition.displayName;
      this.type = definition.type || "generic-rest";
      this.models = Object.freeze((definition.models || []).slice());
      this.capabilities = Object.freeze(Object.assign({
        supportsTextToImage: false,
        supportsImageToImage: false,
        supportsMultipleReferences: false,
        supportsMask: false,
        supportsNegativePrompt: false,
        supportsAspectRatio: false,
        supportsSeed: false,
        supportsCustomModels: false
      }, definition.capabilities || {}));
    }

    validateConfig() {
      throw new AppError(ErrorCodes.NOT_IMPLEMENTED, "validateConfig() is not implemented.");
    }

    testConnection() {
      return Promise.reject(new AppError(ErrorCodes.NOT_IMPLEMENTED, "testConnection() is not implemented."));
    }

    getModels() { return this.models.slice(); }
    getModel(modelId) { return this.models.find(function match(model) { return model.id === modelId; }) || null; }
    addModel(model) {
      if (!model || !model.id) throw new AppError(ErrorCodes.MODEL_REQUIRED, "Model ID is required.");
      var normalized = Object.assign({}, model, {
        id: String(model.id),
        modelId: String(model.modelId || model.id),
        displayName: String(model.displayName || model.id),
        family: model.family || model.requestFamily || null,
        requestFamily: model.requestFamily || model.family || null
      });
      var list = this.models.filter(function different(item) { return item.id !== normalized.id; });
      list.push(normalized);
      this.models = Object.freeze(list);
      return normalized;
    }
    getCapabilities() { return Object.assign({}, this.capabilities); }

    generate() {
      return Promise.reject(new AppError(ErrorCodes.NOT_IMPLEMENTED, "generate() is not implemented."));
    }

    parseResponse(response) { return response; }

    extractImages() {
      throw new AppError(ErrorCodes.NOT_IMPLEMENTED, "extractImages() is not implemented.");
    }
  }

  return { BaseProvider: BaseProvider };
}));
