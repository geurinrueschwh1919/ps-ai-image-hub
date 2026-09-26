(function defineSecretStore(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createSecretStore(root) {
  "use strict";
  class SecretStore {
    constructor(options) {
      this.namespace = options && options.namespace || "ps-ai-image-hub.compat.cep11";
      this.storage = options && options.storage || root.sessionStorage;
      this.persistence = options && options.persistence || null;
    }
    key(name) { return this.namespace + ":" + name; }
    set(name, secret, options) {
      if (typeof secret !== "string" || !secret) throw new TypeError("Secret must be a non-empty string.");
      this.storage.setItem(this.key(name), secret);
      if (this.persistence && options && options.remember === true) this.persistence.set(this.key(name), secret);
      if (this.persistence && options && options.remember === false) this.persistence.remove(this.key(name));
    }
    get(name) {
      var value = this.storage.getItem(this.key(name));
      if (!value && this.persistence) {
        value = this.persistence.get(this.key(name));
        if (value) this.storage.setItem(this.key(name), value);
      }
      return value;
    }
    hydrate(names) {
      var store = this.persistence;
      if (store && typeof store.reload === "function") store.reload();
      var restored = [];
      (names || []).forEach((name) => {
        var value = store && store.get(this.key(name));
        if (value) { this.storage.setItem(this.key(name), value); restored.push(name); }
      });
      return restored;
    }
    isRemembered(name) { return Boolean(this.persistence && this.persistence.has(this.key(name))); }
    forget(name) { if (this.persistence) this.persistence.remove(this.key(name)); }
    remove(name) { this.storage.removeItem(this.key(name)); if (this.persistence) this.persistence.remove(this.key(name)); }
    clearKnown(names) {
      (names || []).forEach((name) => this.remove(name));
    }
  }
  return { SecretStore: SecretStore };
}));
