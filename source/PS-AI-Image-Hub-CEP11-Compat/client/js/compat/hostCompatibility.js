(function defineHostCompatibility(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createHostCompatibility(root) {
  "use strict";
  var EMPTY_HOST = { hostName: "unknown", hostVersion: "unknown", hostMajor: null, os: "unknown", extensionVersion: "1.0.3" };
  var CAPABILITY_NAMES = ["documentAccess", "currentCanvasExport", "currentSelectionExport", "layerImport", "tempDocumentWorkflow", "fileOpen"];

  function cloneEmptyHost() {
    return { hostName: EMPTY_HOST.hostName, hostVersion: EMPTY_HOST.hostVersion, hostMajor: EMPTY_HOST.hostMajor,
      os: EMPTY_HOST.os, extensionVersion: EMPTY_HOST.extensionVersion };
  }

  function parseMajor(version) {
    var match = String(version || "").match(/^(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function readHostEnvironment(options) {
    var settings = options || {};
    var scope = settings.root || root || {};
    var result = cloneEmptyHost();
    var cs = settings.csInterface || null;
    try {
      if (!cs && typeof scope.CSInterface === "function") cs = new scope.CSInterface();
      if (cs && typeof cs.getHostEnvironment === "function") {
        var environment = cs.getHostEnvironment();
        if (typeof environment === "string") environment = JSON.parse(environment);
        environment = environment || {};
        result.hostName = String(environment.appName || environment.hostName || "unknown");
        result.hostVersion = String(environment.appVersion || environment.hostVersion || "unknown");
        result.hostMajor = parseMajor(result.hostVersion);
        result.os = String(environment.appSkinInfo && environment.appSkinInfo.systemInformation ||
          environment.osInformation || scope.navigator && scope.navigator.platform || "unknown");
      }
    } catch (error) { return result; }
    return result;
  }

  function compatibilityProfile(hostInfo) {
    var host = hostInfo || EMPTY_HOST;
    if (host.hostName !== "PHSP") return host.hostName === "unknown" ? "UNKNOWN_CEP11" : "UNSUPPORTED_HOST";
    if (host.hostMajor === 23) return "PS23_CEP11";
    if (host.hostMajor === 24) return "PS24_CEP11";
    if (host.hostMajor === 25) return "PS25_CEP11";
    return "UNSUPPORTED_HOST";
  }

  function emptyCapabilities() {
    var value = {};
    CAPABILITY_NAMES.forEach(function setFalse(name) { value[name] = false; });
    return value;
  }

  function sanitizeCapabilities(value) {
    var safe = emptyCapabilities();
    CAPABILITY_NAMES.forEach(function copy(name) { safe[name] = Boolean(value && value[name]); });
    return safe;
  }

  function capabilityFallback(error) {
    try {
      var logger = root && root.PSAIImageHubCompat && root.PSAIImageHubCompat.logger;
      if (logger && typeof logger.warn === "function") logger.warn("HOST_CAPABILITIES_DEGRADED", {
        name: String(error && error.name || "Error").slice(0, 80),
        code: String(error && error.code || "HOST_CAPABILITY_PROBE_FAILED").slice(0, 120),
        message: String(error && error.message || error || "Host capability probe failed.").slice(0, 500)
      });
    } catch (loggingError) { /* Diagnostics must never block panel startup. */ }
    return emptyCapabilities();
  }

  function getHostCapabilities(photoshopBridge) {
    if (!photoshopBridge || typeof photoshopBridge.invoke !== "function") return Promise.resolve(emptyCapabilities());
    var request;
    try { request = photoshopBridge.invoke("getHostCapabilities"); }
    catch (error) { return Promise.resolve(capabilityFallback(error)); }
    return Promise.resolve(request).then(sanitizeCapabilities, capabilityFallback);
  }

  return {
    HOST_CAPABILITY_NAMES: CAPABILITY_NAMES.slice(),
    readHostEnvironment: readHostEnvironment,
    compatibilityProfile: compatibilityProfile,
    getHostCapabilities: getHostCapabilities,
    emptyHostCapabilities: emptyCapabilities,
    sanitizeHostCapabilities: sanitizeCapabilities
  };
}));
