(function defineStorageManager(root, factory) {
  "use strict";
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(root, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createStorageManager(root, logging) {
  "use strict";

  var CATEGORIES = Object.freeze(["temporaryInputs", "recoveryImages", "recoveryMetadata", "historyImages", "historyMetadata",
    "downloads", "logs", "config", "sensitiveConfig", "other"]);

  function normalizePath(path) {
    var input = String(path || "").replace(/^file:\/+/i, "").replace(/\\/g, "/");
    var drive = input.match(/^[A-Za-z]:/) ? input.slice(0, 2).toLowerCase() : "";
    if (drive) input = input.slice(2);
    var parts = [];
    input.split("/").forEach(function segment(value) {
      if (!value || value === ".") return;
      if (value === "..") { if (parts.length) parts.pop(); else parts.push(".."); }
      else parts.push(value);
    });
    return drive + "/" + parts.join("/");
  }
  function isInsideRoot(path, rootPath) {
    var target = normalizePath(path).toLowerCase(), base = normalizePath(rootPath).replace(/\/$/, "").toLowerCase();
    return target === base || target.indexOf(base + "/") === 0;
  }
  function join(rootPath, name) { return String(rootPath) + (String(rootPath).indexOf("\\") !== -1 || /^[A-Za-z]:/.test(rootPath) ? "\\" : "/") + name; }
  function blankCategory() { return { fileCount: 0, files: [] }; }
  function blankReport(rootPath, unavailable, message) {
    var categories = {}; CATEGORIES.forEach(function init(name) { categories[name] = blankCategory(); });
    return { rootPath: rootPath || "", categories: categories, totalFiles: 0, unreadableFileCount: 0,
      unavailable: unavailable === true, errorMessage: message || "" };
  }
  function isDirectory(stat) {
    var data = stat && stat.data || {};
    return typeof data.isDirectory === "function" ? data.isDirectory() : data.isDirectory === true || data.type === "directory";
  }

  class StorageManager {
    constructor(options) {
      var settings = options || {};
      this.photoshopBridge = settings.photoshopBridge;
      this.cepFs = settings.cepFs || root.cep && root.cep.fs;
      this.historyStore = settings.historyStore || null;
      this.taskStore = settings.taskStore || null;
      this.explicitRoot = settings.rootPath || null;
    }
    rootPath() {
      if (this.explicitRoot) return this.explicitRoot;
      return join(this.photoshopBridge.getUserDataRoot(), "PSAIImageHubCompat");
    }
    classify(path) {
      var rel = normalizePath(path).slice(normalizePath(this.rootPath()).length).replace(/^\//, "").toLowerCase();
      if (rel === "sensitive-provider-config.json") return "sensitiveConfig";
      if (/^task-recovery\/.+\/(?:main-preview|ref-\d+-preview).*\.(?:png|jpe?g)$/i.test(rel)) return "recoveryImages";
      if (/^task-recovery\/.+\/metadata\.json$/i.test(rel)) return "recoveryMetadata";
      if (/^history\/images\/.+\.(?:png|jpe?g)$/i.test(rel)) return "historyImages";
      if (rel === "history/history.json") return "historyMetadata";
      if (/^(?:temp-import\/|reference-(?:canvas|selection)-|psai-reference-)/i.test(rel)) return "temporaryInputs";
      if (/^generated-.+\.(?:png|jpe?g)$/i.test(rel)) return "downloads";
      if (/^(?:logs\/|.+\.log$)/i.test(rel)) return "logs";
      if (/\.(?:json|cfg)$/i.test(rel)) return "config";
      return "other";
    }
    walk(directory, output, scanState) {
      if (!this.cepFs || !this.cepFs.readdir || !this.cepFs.stat) return output;
      var listing;
      try { listing = this.cepFs.readdir(directory); } catch (error) { return output; }
      if (!listing || listing.err !== 0 || !Array.isArray(listing.data)) return output;
      listing.data.forEach((name) => {
        if (name === "." || name === "..") return;
        var path = join(directory, name), stat;
        try { stat = this.cepFs.stat(path); }
        catch (error) {
          scanState.unreadableFileCount += 1;
          logging.logger.warn("CACHE_STAT_SKIPPED", { fileName: String(name), message: error && error.message });
          return;
        }
        if (!stat || stat.err !== 0) {
          scanState.unreadableFileCount += 1;
          logging.logger.warn("CACHE_STAT_SKIPPED", { fileName: String(name), errorCode: stat && stat.err });
          return;
        }
        if (isDirectory(stat)) this.walk(path, output, scanState);
        else {
          output.push(path);
        }
      });
      return output;
    }
    scan() {
      var rootPath = "";
      try {
        rootPath = this.rootPath();
        if (!rootPath || !this.cepFs || typeof this.cepFs.readdir !== "function" || typeof this.cepFs.stat !== "function") {
          return blankReport(rootPath, true, "CEP storage APIs are unavailable.");
        }
        var result = blankReport(rootPath, false, ""), categories = result.categories;
        var scanState = { unreadableFileCount: 0 }, files = this.walk(rootPath, [], scanState);
        files.forEach((filePath) => {
          var name = this.classify(filePath), category = categories[name];
          category.files.push(filePath); category.fileCount += 1;
        });
        result.totalFiles = files.length; result.unreadableFileCount = scanState.unreadableFileCount;
        logging.logger.info("CACHE_SCAN_DONE", { fileCount: result.totalFiles, unreadableFileCount: result.unreadableFileCount });
        return result;
      } catch (error) {
        logging.logger.warn("Cache scan unavailable", { message: error && error.message });
        return blankReport(rootPath, true, error && error.message || "Storage scan failed.");
      }
    }
    deleteFiles(files) {
      var rootPath = this.rootPath(), deleted = 0;
      (files || []).forEach((path) => {
        if (!isInsideRoot(path, rootPath) || normalizePath(path).toLowerCase() === normalizePath(rootPath).toLowerCase()) throw new Error("Refusing to delete outside PSAIImageHubCompat data root.");
        try { var result = this.cepFs.deleteFile(path); if (!result || result.err === 0) deleted += 1; } catch (error) { /* missing files are harmless */ }
      });
      return deleted;
    }
    clear(categoryNames) {
      var names = Array.isArray(categoryNames) ? categoryNames : [categoryNames];
      var allowed = ["temporaryInputs", "recoveryImages", "historyImages", "downloads"];
      names.forEach(function validate(name) { if (allowed.indexOf(name) === -1) throw new Error("Storage category is not clearable as image cache: " + name); });
      var scan = this.scan(), files = [];
      if (scan.unavailable) throw new Error("Storage scan is unavailable.");
      names.forEach(function collect(name) { files = files.concat(scan.categories[name].files); });
      var deleted = this.deleteFiles(files);
      if (names.indexOf("historyImages") !== -1 && this.historyStore && this.historyStore.clearImageReferences) this.historyStore.clearImageReferences();
      logging.logger.info("CACHE_CLEAR_DONE", { categories: names.slice(), deletedFiles: deleted });
      return this.scan();
    }
    clearAllImages() { return this.clear(["temporaryInputs", "recoveryImages", "historyImages", "downloads"]); }
    clearRecoveryRecords() {
      var scan = this.scan(), files = scan.categories.recoveryImages.files.concat(scan.categories.recoveryMetadata.files);
      if (scan.unavailable) throw new Error("Storage scan is unavailable.");
      var deleted = this.deleteFiles(files); if (this.taskStore) this.taskStore.clear();
      logging.logger.info("CACHE_CLEAR_DONE", { categories: ["recoveryImages", "recoveryMetadata"], deletedFiles: deleted });
      return this.scan();
    }
  }

  return { StorageManager: StorageManager, STORAGE_CATEGORIES: CATEGORIES, normalizeStoragePath: normalizePath,
    isPathInsideStorageRoot: isInsideRoot, createEmptyStorageReport: blankReport };
}));
