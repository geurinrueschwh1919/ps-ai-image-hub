/*
 * PS AI Image Hub minimal CSInterface adapter.
 *
 * This project-owned compatibility subset delegates to Adobe CEP's public
 * window.__adobe_cep__ object. It intentionally implements only the methods
 * used by this extension and can be replaced by Adobe's full CSInterface.js
 * v11.0.0 without changing PhotoshopBridge.
 */
(function attachCSInterface(root) {
  "use strict";

  function SystemPath() {}
  SystemPath.EXTENSION = "extension";
  SystemPath.USER_DATA = "userData";

  function CSInterface() {}

  CSInterface.prototype.evalScript = function evalScript(script, callback) {
    var done = typeof callback === "function" ? callback : function noop() {};
    if (!root.__adobe_cep__ || typeof root.__adobe_cep__.evalScript !== "function") {
      done("EvalScript error.");
      return;
    }
    root.__adobe_cep__.evalScript(script, done);
  };

  CSInterface.prototype.getHostEnvironment = function getHostEnvironment() {
    if (!root.__adobe_cep__ || typeof root.__adobe_cep__.getHostEnvironment !== "function") return null;
    var value = root.__adobe_cep__.getHostEnvironment();
    try { return JSON.parse(value); }
    catch (error) { return null; }
  };

  CSInterface.prototype.getCurrentApiVersion = function getCurrentApiVersion() {
    if (!root.__adobe_cep__ || typeof root.__adobe_cep__.getCurrentApiVersion !== "function") return null;
    var value = root.__adobe_cep__.getCurrentApiVersion();
    try { return JSON.parse(value); }
    catch (error) { return value; }
  };

  CSInterface.prototype.getSystemPath = function getSystemPath(pathType) {
    if (!root.__adobe_cep__ || typeof root.__adobe_cep__.getSystemPath !== "function") return null;
    var path = decodeURI(root.__adobe_cep__.getSystemPath(pathType));
    if (/^file:\/\/\//i.test(path)) path = path.replace(/^file:\/\/\//i, "");
    else if (/^file:\/\//i.test(path)) path = path.replace(/^file:\/\//i, "");
    return path;
  };

  root.CSInterface = CSInterface;
  root.SystemPath = SystemPath;
}(typeof window !== "undefined" ? window : globalThis));

if (typeof module === "object" && module.exports) {
  module.exports = { CSInterface: globalThis.CSInterface, SystemPath: globalThis.SystemPath };
}
