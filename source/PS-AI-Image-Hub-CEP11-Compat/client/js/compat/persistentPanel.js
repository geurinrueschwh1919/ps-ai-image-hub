(function definePersistentPanel(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPersistentPanelApi(root) {
  "use strict";

  var EVENT_TYPE = "com.adobe.PhotoshopPersistent";
  var EVENT_SCOPE = "APPLICATION";

  function safeWarning(logger, error) {
    if (!logger || typeof logger.warn !== "function") return;
    try {
      logger.warn("CEP_PERSISTENT_PANEL_DEGRADED", {
        name: String(error && error.name || "Error").slice(0, 80),
        message: "Persistent panel request unavailable."
      });
    } catch (loggingError) { /* Diagnostics must never block startup. */ }
  }

  function LocalCSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
    this.data = "";
  }

  function createEventInterface(runtime) {
    var nativeCep = runtime && runtime.__adobe_cep__;
    var baseInterface = typeof runtime.CSInterface === "function" ? new runtime.CSInterface() : null;
    return {
      getExtensionID: function getExtensionID() {
        if (baseInterface && typeof baseInterface.getExtensionID === "function") return baseInterface.getExtensionID();
        if (nativeCep && typeof nativeCep.getExtensionId === "function") return nativeCep.getExtensionId();
        return "";
      },
      dispatchEvent: function dispatchEvent(event) {
        if (baseInterface && typeof baseInterface.dispatchEvent === "function") return baseInterface.dispatchEvent(event);
        if (!nativeCep || typeof nativeCep.dispatchEvent !== "function") return false;
        if (event && typeof event.data === "object") event.data = JSON.stringify(event.data);
        nativeCep.dispatchEvent(event);
        return true;
      }
    };
  }

  function PersistentPanelController(options) {
    this.root = options && options.root || root;
    this.logger = options && options.logger || null;
    this.attempted = false;
  }

  PersistentPanelController.prototype.request = function requestPersistentPanel() {
    if (this.attempted) return { requested: false, duplicate: true, eventType: EVENT_TYPE, scope: EVENT_SCOPE };
    this.attempted = true;
    try {
      var runtime = this.root || {};
      var csInterface = createEventInterface(runtime);
      var extensionId = csInterface.getExtensionID();
      if (!extensionId) throw new Error("CEP extension ID is unavailable.");
      var EventConstructor = typeof runtime.CSEvent === "function" ? runtime.CSEvent : LocalCSEvent;
      var event = new EventConstructor(EVENT_TYPE, EVENT_SCOPE);
      event.extensionId = extensionId;
      var dispatched = csInterface.dispatchEvent(event);
      if (dispatched === false) throw new Error("CEP event dispatch is unavailable.");
      return { requested: true, duplicate: false, eventType: EVENT_TYPE, scope: EVENT_SCOPE };
    } catch (error) {
      safeWarning(this.logger, error);
      return { requested: false, duplicate: false, failed: true, eventType: EVENT_TYPE, scope: EVENT_SCOPE };
    }
  };

  PersistentPanelController.prototype.hasAttempted = function hasAttempted() { return this.attempted; };

  var singleton = new PersistentPanelController({ root: root });
  return {
    CEP_PERSISTENT_EVENT: EVENT_TYPE,
    CEP_PERSISTENT_SCOPE: EVENT_SCOPE,
    LocalCSEvent: LocalCSEvent,
    createPersistentEventInterface: createEventInterface,
    PersistentPanelController: PersistentPanelController,
    requestPersistentPanel: function requestPersistentPanel(options) {
      if (options && options.logger) singleton.logger = options.logger;
      return singleton.request();
    }
  };
}));
