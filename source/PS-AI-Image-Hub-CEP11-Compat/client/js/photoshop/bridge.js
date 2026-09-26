(function definePhotoshopBridge(root, factory) {
  "use strict";
  var serialization = typeof module === "object" && module.exports
    ? require("./bridgeSerialization")
    : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(serialization, errors, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPhotoshopBridge(serialization, errors, root) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function validateRelativeAssetPath(relativePath) {
    var value = String(relativePath || "").replace(/\\/g, "/");
    var segments = value.split("/");
    if (!value || value.indexOf("\0") !== -1 || /^(?:[A-Za-z]:|\/)/.test(value)) {
      throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Extension asset path must be relative.");
    }
    if (segments.some(function invalid(segment) { return !segment || segment === "." || segment === ".."; })) {
      throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Extension asset path contains an invalid segment.");
    }
    return segments;
  }

  class PhotoshopBridge {
    constructor(options) {
      this.csInterface = options && options.csInterface || null;
    }

    isAvailable() {
      return Boolean(this.csInterface || (typeof root.CSInterface === "function" && root.__adobe_cep__));
    }

    getInterface() {
      if (!this.csInterface && typeof root.CSInterface === "function") this.csInterface = new root.CSInterface();
      if (!this.csInterface || typeof this.csInterface.evalScript !== "function") {
        throw new AppError(ErrorCodes.BRIDGE_UNAVAILABLE, "CEP CSInterface is unavailable.");
      }
      return this.csInterface;
    }

    invoke(method, args) {
      var script = serialization.buildHostCall(method, args || []);
      var csInterface;
      try { csInterface = this.getInterface(); }
      catch (error) { return Promise.reject(error); }
      return new Promise(function execute(resolve, reject) {
        csInterface.evalScript(script, function onResult(raw) {
          try { resolve(serialization.parseBridgeResponse(raw)); }
          catch (error) { reject(error); }
        });
      });
    }

    getExtensionRoot() {
      var csInterface = this.getInterface();
      if (typeof csInterface.getSystemPath !== "function") {
        throw new AppError(ErrorCodes.BRIDGE_UNAVAILABLE, "CEP getSystemPath() is unavailable.");
      }
      var pathType = root.SystemPath && root.SystemPath.EXTENSION || "extension";
      var extensionRoot;
      try { extensionRoot = csInterface.getSystemPath(pathType); }
      catch (error) {
        throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Could not read the CEP extension path.", { cause: error });
      }
      if (!extensionRoot || String(extensionRoot).indexOf("\0") !== -1) {
        throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "CEP returned an invalid extension path.");
      }
      return String(extensionRoot).replace(/[\\/]+$/, "");
    }

    getUserDataRoot() {
      var csInterface = this.getInterface();
      var pathType = root.SystemPath && root.SystemPath.USER_DATA || "userData";
      var userDataRoot;
      try { userDataRoot = csInterface.getSystemPath(pathType); }
      catch (error) { throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Could not read the CEP user data path."); }
      if (!userDataRoot || String(userDataRoot).indexOf("\0") !== -1) {
        throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "CEP returned an invalid user data path.");
      }
      return String(userDataRoot).replace(/[\\/]+$/, "");
    }

    resolveExtensionAsset(relativePath) {
      var segments = validateRelativeAssetPath(relativePath);
      var extensionRoot = this.getExtensionRoot();
      var useBackslash = /^[A-Za-z]:[\\/]/.test(extensionRoot) || extensionRoot.indexOf("\\") !== -1;
      if (useBackslash) extensionRoot = extensionRoot.replace(/\//g, "\\");
      return extensionRoot + (useBackslash ? "\\" : "/") + segments.join(useBackslash ? "\\" : "/");
    }

    ping() { return this.invoke("ping"); }
    getPhotoshopVersion() { return this.invoke("getPhotoshopVersion"); }
    hasOpenDocument() { return this.invoke("hasOpenDocument"); }
    getActiveDocumentName() { return this.invoke("getActiveDocumentName"); }
    getDocumentMetadata() { return this.invoke("getDocumentMetadata"); }
    getSelectionBounds() { return this.invoke("getSelectionBounds"); }
    exportReferenceImage(mode, filePath) { return this.invoke("exportReferenceImage", [mode, filePath]); }
    importImage(filePath) { return this.invoke("importImage", [filePath]); }
    importSmartObjectToBounds(filePath, bounds) {
      var target = bounds || {};
      var left = Number(target.left), top = Number(target.top), width = Number(target.width), height = Number(target.height);
      if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) {
        return Promise.reject(new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "Smart Object import requires valid target bounds."));
      }
      return this.invoke("importSmartObjectToBounds", [filePath, left, top, width, height]);
    }
  }

  return { PhotoshopBridge: PhotoshopBridge, validateRelativeAssetPath: validateRelativeAssetPath };
}));
