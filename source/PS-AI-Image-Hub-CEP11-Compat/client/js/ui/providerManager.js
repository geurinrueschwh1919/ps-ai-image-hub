(function defineProviderManager(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createProviderManager(errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var KEY_UNCHANGED = "KEY_UNCHANGED";
  var KEY_UPDATED = "KEY_UPDATED";
  var KEY_CLEARED = "KEY_CLEARED";

  function maskSecret(value) {
    var secret = String(value || "");
    return secret ? "••••••••••••" + (secret.length > 4 ? secret.slice(-4) : "") : "";
  }

  class ProviderManager {
    constructor(registry, options) {
      this.registry = registry;
      this.providerStore = options && options.providerStore || null;
      this.secretStore = options && options.secretStore || null;
      this.providerFactory = options && options.providerFactory || null;
      this.configs = [];
    }
    loadConfiguredProviders(preloadedConfigs) {
      if (!this.providerStore || !this.providerFactory) return [];
      this.configs = Array.isArray(preloadedConfigs) ? preloadedConfigs.slice() : this.providerStore.load();
      this.configs.forEach((config) => {
        try {
          var existing = this.registry.get(config.id);
          if (existing && existing.isBuiltIn && typeof existing.updateConfig === "function") existing.updateConfig(config);
          else this.registry.register(this.providerFactory.create(config));
        }
        catch (error) { /* Invalid saved records remain editable and do not stop panel startup. */ }
      });
      return this.configs.slice();
    }
    listConfiguredProviders() { return this.configs.slice(); }
    listEditableProviderConfigs() {
      var builtIns = this.registry.list().filter(function builtIn(provider) { return provider.isBuiltIn && provider.config; })
        .map(function config(provider) { return provider.config; });
      return builtIns.concat(this.configs.filter(function custom(config) {
        return !builtIns.some(function duplicate(builtIn) { return builtIn.id === config.id; });
      }));
    }
    getProviderConfig(providerId) {
      var stored = this.configs.find(function match(config) { return config.id === providerId; });
      var provider = this.registry.get(providerId);
      return stored || provider && provider.isBuiltIn && provider.config || null;
    }
    saveProviderConfig(config, apiKey, options) {
      if (!this.providerStore || !this.providerFactory || !this.secretStore) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Provider persistence is unavailable.");
      }
      var existingIndex = this.configs.findIndex(function match(item) { return item.id === config.id; });
      var secretName = "provider:" + config.id + ":apiKey";
      var existingSecret = this.secretStore.get(secretName);
      var keyAction = options && options.keyAction || (apiKey ? KEY_UPDATED : KEY_UNCHANGED);
      if ([KEY_UNCHANGED, KEY_UPDATED, KEY_CLEARED].indexOf(keyAction) === -1) throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Unknown API Key update state.");
      if (keyAction === KEY_UPDATED) {
        if (!apiKey) throw new AppError(ErrorCodes.MISSING_API_KEY, "Updated API key is empty.");
        this.secretStore.set(secretName, apiKey, { remember: options && options.remember === true });
        existingSecret = apiKey;
      } else if (keyAction === KEY_CLEARED) {
        this.secretStore.remove(secretName); existingSecret = null;
      } else if (options && options.remember === true && existingSecret) {
        this.secretStore.set(secretName, existingSecret, { remember: true });
      } else if (options && options.forgetPersistent === true) {
        this.secretStore.forget(secretName);
      }
      if (config.authType !== "none" && !existingSecret) throw new AppError(ErrorCodes.MISSING_API_KEY, "API key is required.");
      var registered = this.registry.get(config.id);
      var provider = registered && registered.isBuiltIn ? registered : this.providerFactory.create(config);
      if (provider.isBuiltIn && typeof provider.updateConfig === "function") provider.updateConfig(config);
      var validation = provider.validateConfig();
      if (!validation.valid) throw new AppError(validation.code || ErrorCodes.INVALID_PROVIDER_CONFIG, validation.errors[0]);
      if (existingIndex >= 0) this.configs.splice(existingIndex, 1, provider.config);
      else this.configs.push(provider.config);
      if (!provider.isBuiltIn) {
        this.registry.unregister(provider.id);
        this.registry.register(provider);
      }
      this.providerStore.save(this.configs);
      return provider;
    }
    deleteProviderConfig(providerId) {
      var index = this.configs.findIndex(function match(item) { return item.id === providerId; });
      var provider = this.registry.get(providerId);
      if (provider && provider.isBuiltIn) return false;
      if (index === -1) return false;
      this.configs.splice(index, 1);
      this.registry.unregister(providerId);
      if (this.secretStore) this.secretStore.remove("provider:" + providerId + ":apiKey");
      if (this.providerStore) this.providerStore.save(this.configs);
      return true;
    }
    listProviders() { return this.registry.list(); }
    getProvider(providerId) { return this.registry.get(providerId); }
    requireProvider(providerId) {
      var provider = this.getProvider(providerId);
      if (!provider) throw new AppError(ErrorCodes.PROVIDER_REQUIRED, "Provider not found: " + (providerId || "(empty)"));
      return provider;
    }
    getModels(providerId) {
      var provider = this.getProvider(providerId);
      return provider ? provider.getModels() : [];
    }
    setSelectedModel(providerId, modelId) {
      var provider = this.requireProvider(providerId);
      if (!provider.getModels().some(function match(model) { return model.id === modelId; })) {
        throw new AppError(ErrorCodes.MODEL_REQUIRED, "Model not found for provider " + providerId + ": " + modelId);
      }
      var config = Object.assign({}, provider.config || this.getProviderConfig(providerId) || {}, { id: providerId, modelId: modelId });
      if (typeof provider.updateConfig === "function") provider.updateConfig(config);
      else provider.config = config;
      var index = this.configs.findIndex(function match(item) { return item.id === providerId; });
      if (index >= 0) this.configs.splice(index, 1, provider.config || config);
      else this.configs.push(provider.config || config);
      if (this.providerStore) this.providerStore.save(this.configs);
      return modelId;
    }
    addRuntimeModel(providerId, model) {
      var provider = this.requireProvider(providerId);
      if (!provider.getCapabilities().supportsCustomModels) throw new AppError(ErrorCodes.MODEL_REQUIRED, "This API service does not accept custom models.");
      return provider.addModel(model);
    }
    async testProviderConfig(config, apiKey) {
      var secretName = "provider:" + config.id + ":apiKey";
      var previous = this.secretStore && this.secretStore.get(secretName);
      var changed = Boolean(apiKey && this.secretStore);
      if (changed) this.secretStore.set(secretName, apiKey);
      try {
        var provider = this.providerFactory.create(config);
        return await provider.testConnection();
      } finally {
        if (changed && previous) this.secretStore.set(secretName, previous);
        else if (changed) this.secretStore.remove(secretName);
      }
    }
    isApiKeyRemembered(providerId) { return Boolean(this.secretStore && this.secretStore.isRemembered("provider:" + providerId + ":apiKey")); }
    getApiKeyStatus(providerId) {
      var value = this.secretStore && this.secretStore.get("provider:" + providerId + ":apiKey");
      return { hasSecret: Boolean(value), remembered: this.isApiKeyRemembered(providerId), masked: maskSecret(value) };
    }
    clearProviderApiKey(providerId) { if (this.secretStore) this.secretStore.remove("provider:" + providerId + ":apiKey"); }
    async getGrsApiKeyCredits(config, apiKey) {
      var provider = this.requireProvider("grs");
      var key = apiKey || this.secretStore.get("provider:grs:apiKey");
      if (!provider.accountClient) throw new AppError(ErrorCodes.NOT_IMPLEMENTED, "GRS account client is unavailable.");
      return provider.accountClient.getApiKeyCredits(provider.resolveBaseUrl(config), key);
    }
  }

  return { ProviderManager: ProviderManager, KEY_UNCHANGED: KEY_UNCHANGED, KEY_UPDATED: KEY_UPDATED, KEY_CLEARED: KEY_CLEARED };
}));
