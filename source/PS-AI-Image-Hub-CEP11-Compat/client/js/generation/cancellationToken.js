(function defineCancellationToken(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createCancellationToken() {
  "use strict";

  class CancellationToken {
    constructor() { this.cancelled = false; this.listeners = []; }
    cancel() {
      if (this.cancelled) return;
      this.cancelled = true;
      this.listeners.slice().forEach(function notify(listener) { listener(); });
      this.listeners = [];
    }
    subscribe(listener) {
      if (this.cancelled) { listener(); return function noop() {}; }
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(function keep(item) { return item !== listener; }); };
    }
  }

  return { CancellationToken: CancellationToken };
}));
