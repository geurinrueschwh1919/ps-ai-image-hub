(function defineCompatFileDialog(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createCompatFileDialog(root) {
  "use strict";
  var METHOD_NAMES = ["showOpenDialog", "showOpenDialogEx", "showSaveDialog", "showSaveDialogEx", "readFile", "writeFile",
    "makedir", "stat", "readdir", "deleteFile", "rename", "copyFile"];

  function unavailable(method) {
    if (method.indexOf("show") === 0) return null;
    return { err: 1, data: null, message: "CEP FS method unavailable: " + method };
  }

  function createFileDialogCompatibility(cepFs) {
    var source = cepFs || root && root.cep && root.cep.fs || null;
    var wrapper = { available: Boolean(source), source: source };
    METHOD_NAMES.forEach(function addMethod(name) {
      wrapper[name] = function invoke() {
        if (!source || typeof source[name] !== "function") return unavailable(name);
        try { return source[name].apply(source, arguments); }
        catch (error) { return unavailable(name); }
      };
    });
    return wrapper;
  }

  return { createFileDialogCompatibility: createFileDialogCompatibility };
}));
