(function defineFeatureDetection(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createFeatureDetection(root) {
  "use strict";

  function isFunction(value) { return typeof value === "function"; }
  function hasObject(value) { return value !== null && (typeof value === "object" || isFunction(value)); }

  function detectCepCapabilities(candidate) {
    var scope = candidate || root || {};
    var cep = scope.cep;
    var cepFs = cep && cep.fs;
    var csPrototype = scope.CSInterface && scope.CSInterface.prototype;
    var storage = scope.localStorage;
    var hasLocalStorage = false;
    try { hasLocalStorage = Boolean(storage && isFunction(storage.getItem) && isFunction(storage.setItem)); }
    catch (error) { hasLocalStorage = false; }
    return {
      hasCSInterface: isFunction(scope.CSInterface),
      hasEvalScript: Boolean(isFunction(scope.CSInterface) && csPrototype && isFunction(csPrototype.evalScript)),
      hasWindowCep: hasObject(cep),
      hasCepFs: hasObject(cepFs),
      hasLocalStorage: hasLocalStorage,
      hasJsonParse: Boolean(scope.JSON && isFunction(scope.JSON.parse)),
      hasJsonStringify: Boolean(scope.JSON && isFunction(scope.JSON.stringify)),
      hasPromise: isFunction(scope.Promise),
      hasXHR: isFunction(scope.XMLHttpRequest),
      hasFetch: isFunction(scope.fetch),
      hasFileReader: isFunction(scope.FileReader),
      hasBlob: isFunction(scope.Blob),
      hasArrayBuffer: isFunction(scope.ArrayBuffer),
      hasURL: isFunction(scope.URL),
      hasURLSearchParams: isFunction(scope.URLSearchParams),
      hasTextEncoder: isFunction(scope.TextEncoder),
      hasTextDecoder: isFunction(scope.TextDecoder),
      hasOpenURLInDefaultBrowser: Boolean(csPrototype && isFunction(csPrototype.openURLInDefaultBrowser)),
      hasSystemPath: Boolean(scope.SystemPath),
      hasFileDialog: Boolean(cepFs && (isFunction(cepFs.showOpenDialog) || isFunction(cepFs.showOpenDialogEx))),
      hasCrypto: Boolean(scope.crypto && isFunction(scope.crypto.getRandomValues)),
      hasNavigator: Boolean(scope.navigator),
      userAgent: String(scope.navigator && scope.navigator.userAgent || "unknown")
    };
  }

  return { detectCepCapabilities: detectCepCapabilities };
}));
