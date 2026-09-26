(function definePersistentSecretStore(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPersistentSecretStore(root) {
  "use strict";

  class PersistentSecretStore {
    constructor(options) {
      this.photoshopBridge = options && options.photoshopBridge;
      this.cepFs = options && options.cepFs || root.cep && root.cep.fs;
      this.values = null;
      this.explicitFilePath = options && options.filePath || null;
    }
    filePath() {
      if (this.explicitFilePath) return this.explicitFilePath;
      var rootPath = this.photoshopBridge.getUserDataRoot();
      var slash = rootPath.indexOf("\\") !== -1 || /^[A-Za-z]:/.test(rootPath) ? "\\" : "/";
      return rootPath + slash + "PSAIImageHubCompat" + slash + "sensitive-provider-config.json";
    }
    ensureDirectory() {
      var file = this.filePath();
      var separator = file.indexOf("\\") !== -1 ? "\\" : "/";
      var folder = file.slice(0, file.lastIndexOf(separator));
      var result = this.cepFs.makedir(folder);
      if (result && result.err !== 0 && (!this.cepFs.stat || this.cepFs.stat(folder).err !== 0)) throw new Error("Could not create sensitive provider config directory.");
    }
    load() {
      if (this.values) return this.values;
      this.values = {};
      if (!this.cepFs || typeof this.cepFs.readFile !== "function") return this.values;
      var result = this.cepFs.readFile(this.filePath());
      if (!result || result.err !== 0 || !result.data) return this.values;
      try {
        var parsed = JSON.parse(String(result.data).replace(/^\uFEFF/, ""));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.values = parsed;
      } catch (error) { this.values = {}; }
      return this.values;
    }
    reload() { this.values = null; return this.load(); }
    save() {
      this.ensureDirectory();
      var serialized = JSON.stringify(this.load());
      var result = this.cepFs.writeFile(this.filePath(), serialized);
      if (!result || result.err !== 0) throw new Error("Could not persist sensitive provider config.");
      var verification = this.cepFs.readFile(this.filePath());
      if (!verification || verification.err !== 0 || typeof verification.data !== "string") throw new Error("Could not verify sensitive provider config write.");
      try {
        var persisted = JSON.parse(String(verification.data).replace(/^\uFEFF/, ""));
        if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) throw new Error("invalid");
        this.values = persisted;
      } catch (error) { throw new Error("Sensitive provider config verification failed."); }
    }
    get(name) { var value = this.load()[name]; return typeof value === "string" && value ? value : null; }
    set(name, secret) { this.load()[name] = secret; this.save(); }
    remove(name) { if (Object.prototype.hasOwnProperty.call(this.load(), name)) { delete this.values[name]; this.save(); } }
    has(name) { return Boolean(this.get(name)); }
  }

  return { PersistentSecretStore: PersistentSecretStore };
}));
