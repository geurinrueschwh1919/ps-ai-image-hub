(function defineCompatStorage(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createCompatStorage() {
  "use strict";
  function MemoryStore() { this.values = {}; this.length = 0; }
  MemoryStore.prototype.key = function key(index) { return Object.keys(this.values)[index] || null; };
  MemoryStore.prototype.getItem = function getItem(name) { return Object.prototype.hasOwnProperty.call(this.values, String(name)) ? this.values[String(name)] : null; };
  MemoryStore.prototype.setItem = function setItem(name, value) {
    var key = String(name); if (!Object.prototype.hasOwnProperty.call(this.values, key)) this.length += 1; this.values[key] = String(value);
  };
  MemoryStore.prototype.removeItem = function removeItem(name) {
    var key = String(name); if (Object.prototype.hasOwnProperty.call(this.values, key)) { delete this.values[key]; this.length -= 1; }
  };
  MemoryStore.prototype.clear = function clear() { this.values = {}; this.length = 0; };

  function createCompatibleStorage(storage, onFallback) {
    var sentinel = "ps-ai-image-hub.compat.cep11.probe";
    try {
      if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new Error("unavailable");
      storage.setItem(sentinel, "1"); storage.removeItem(sentinel);
      return { storage: storage, persistent: true, fallback: null };
    } catch (error) {
      if (typeof onFallback === "function") onFallback(error);
      return { storage: new MemoryStore(), persistent: false, fallback: "MemoryStore" };
    }
  }

  return { MemoryStore: MemoryStore, createCompatibleStorage: createCompatibleStorage };
}));
