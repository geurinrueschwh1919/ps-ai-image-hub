(function defineProviderRegistry(root, factory) {
  "use strict";
  var dependencies = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createProviderRegistry(dependencies) {
  "use strict";
  var AppError = dependencies.AppError;
  var ErrorCodes = dependencies.ErrorCodes;

  class ProviderRegistry {
    constructor() { this.providers = new Map(); }

    register(provider) {
      if (!provider || !provider.id) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER, "Cannot register a provider without an ID.");
      }
      if (this.providers.has(provider.id)) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER, "Provider already registered: " + provider.id);
      }
      this.providers.set(provider.id, provider);
      return provider;
    }

    unregister(providerId) { return this.providers.delete(providerId); }
    get(providerId) { return this.providers.get(providerId) || null; }
    list() { return Array.from(this.providers.values()); }
    get size() { return this.providers.size; }
  }

  return { ProviderRegistry: ProviderRegistry };
}));

