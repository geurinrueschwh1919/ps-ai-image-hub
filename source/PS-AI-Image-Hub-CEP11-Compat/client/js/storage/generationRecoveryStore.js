(function defineGenerationRecoveryStore(root, factory) {
  "use strict";
  var imagePayload = typeof module === "object" && module.exports ? require("../generation/imagePayloadOptimizer") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(root, imagePayload, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGenerationRecoveryStore(root, imagePayload, logging) {
  "use strict";
  var RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  function separator(path) { return String(path).indexOf("\\") !== -1 || /^[A-Za-z]:/.test(path) ? "\\" : "/"; }
  function safeFolderName(value) { return encodeURIComponent(String(value || "task")).replace(/%/g, "_").slice(0, 180); }
  function extension(mimeType) { return String(mimeType).toLowerCase() === "image/jpeg" ? ".jpg" : ".png"; }
  function fileUrl(path) {
    var normalized = String(path || "").replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) return "file:///" + encodeURI(normalized).replace(/#/g, "%23");
    return "file://" + encodeURI(normalized).replace(/#/g, "%23");
  }
  function rawBase64(image) {
    var value = imagePayload.rawImageApiValue(image);
    return value && !/^https?:\/\//i.test(value) ? value : "";
  }
  function copyBounds(value) {
    if (!value) return null;
    var left = Number(value.left), top = Number(value.top), width = Number(value.width), height = Number(value.height);
    if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) return null;
    return { left: left, top: top, right: isFinite(Number(value.right)) ? Number(value.right) : left + width,
      bottom: isFinite(Number(value.bottom)) ? Number(value.bottom) : top + height, width: width, height: height };
  }

  class GenerationRecoveryStore {
    constructor(options) {
      var settings = options || {};
      this.photoshopBridge = settings.photoshopBridge;
      this.cepFs = settings.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = settings.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
      this.explicitRoot = settings.rootPath || null;
      this.now = settings.now || function now() { return Date.now(); };
      this.retentionMs = Number(settings.retentionMs) > 0 ? Number(settings.retentionMs) : RETENTION_MS;
    }
    rootPath() {
      if (this.explicitRoot) return this.explicitRoot;
      var userRoot = this.photoshopBridge.getUserDataRoot(), slash = separator(userRoot);
      return userRoot + slash + "PSAIImageHubCompat" + slash + "task-recovery";
    }
    taskPath(taskId) { return this.rootPath() + separator(this.rootPath()) + safeFolderName(taskId); }
    ensure(path) {
      var result = this.cepFs.makedir(path);
      if (result && result.err !== 0 && (!this.cepFs.stat || this.cepFs.stat(path).err !== 0)) throw new Error("Could not create task recovery directory.");
    }
    writeImage(folder, fileName, image) {
      var value = rawBase64(image);
      if (!value) return null;
      var path = folder + separator(folder) + fileName + extension(image.mimeType);
      var result = this.cepFs.writeFile(path, value, this.base64Encoding);
      if (!result || result.err !== 0) return null;
      return {
        fileName: path.slice(path.lastIndexOf(separator(path)) + 1), width: Number(image.width) || null,
        height: Number(image.height) || null, mimeType: image.mimeType || "image/png", sourceLabel: "task-snapshot",
        originalSourceType: String(image.sourceType || "local-image"), bounds: copyBounds(image.bounds), documentBounds: copyBounds(image.documentBounds)
      };
    }
    pruneExpired() {
      if (!this.cepFs || !this.cepFs.readdir || !this.cepFs.readFile || !this.cepFs.deleteFile) return 0;
      var listing = this.cepFs.readdir(this.rootPath()), deleted = 0;
      if (!listing || listing.err !== 0 || !Array.isArray(listing.data)) return 0;
      listing.data.forEach((name) => {
        if (name === "." || name === "..") return;
        var folder = this.rootPath() + separator(this.rootPath()) + name, slash = separator(folder);
        var metadata = this.cepFs.readFile(folder + slash + "metadata.json");
        if (!metadata || metadata.err !== 0 || !metadata.data) return;
        var parsed;
        try { parsed = JSON.parse(metadata.data); } catch (error) { return; }
        if (!parsed.createdAt || this.now() - new Date(parsed.createdAt).getTime() <= this.retentionMs) return;
        var files = this.cepFs.readdir(folder);
        if (files && files.err === 0 && Array.isArray(files.data)) files.data.forEach((file) => {
          if (file !== "." && file !== "..") { try { this.cepFs.deleteFile(folder + slash + file); deleted += 1; } catch (error) { /* best effort */ } }
        });
      });
      return deleted;
    }
    saveSnapshot(taskId, input) {
      if (!taskId || !this.cepFs) return null;
      this.ensure(this.rootPath());
      this.pruneExpired();
      var folder = this.taskPath(taskId); this.ensure(folder);
      var set = input && input.imageInputs || {};
      var main = set.mainImage ? this.writeImage(folder, "main-preview", set.mainImage) : null;
      var references = (set.referenceImages || []).map((image, index) => {
        var number = index + 1, label = number < 10 ? "0" + number : String(number);
        return this.writeImage(folder, "ref-" + label + "-preview", image);
      }).filter(Boolean);
      var metadata = {
        version: 1, taskId: String(taskId), createdAt: new Date(this.now()).toISOString(), providerId: String(input.providerId || "grs"),
        executionId: String(input.executionId || ""), historyId: String(input.historyId || ""),
        modelId: String(input.modelId || ""), prompt: String(input.finalPrompt || input.prompt || ""),
        finalPrompt: String(input.finalPrompt || input.prompt || ""),
        aspectRatio: String(input.aspectRatio || ""),
        resolutionTier: String(input.resolutionTier || input.imageSize || ""), node: String(input.node || ""), baseUrl: String(input.baseUrl || ""),
        region: String(input.region || input.providerMetadata && input.providerMetadata.region || ""),
        workspaceId: String(input.workspaceId || input.providerMetadata && input.providerMetadata.workspaceId || ""),
        negativePrompt: String(input.negativePrompt || ""),
        promptExtend: input.promptExtend !== false,
        promptExtendMode: String(input.promptExtendMode || "direct"),
        enableThinking: input.enableThinking !== false,
        seed: input.seed === undefined || input.seed === null ? "" : String(input.seed),
        matchMainSize: input.matchMainSize !== false,
        mainTarget: input.mainTarget || (main ? { sourceType: main.originalSourceType, bounds: main.bounds, documentBounds: main.documentBounds,
          width: main.width, height: main.height } : null),
        mainTargetDimensions: input.mainTargetDimensions || (main ? { width: main.width, height: main.height } : null),
        mainImage: main, referenceImages: references
      };
      var metadataPath = folder + separator(folder) + "metadata.json";
      var result = this.cepFs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      if (!result || result.err !== 0) throw new Error("Could not write task recovery metadata.");
      logging.logger.info("RECOVERY_SNAPSHOT_SAVED", { provider: metadata.providerId, model: metadata.modelId,
        mainImageCount: main ? 1 : 0, referenceCount: references.length });
      return metadata;
    }
    readImage(folder, descriptor) {
      if (!descriptor || !descriptor.fileName) return null;
      try {
        var path = folder + separator(folder) + descriptor.fileName;
        var read = this.cepFs.readFile(path, this.base64Encoding);
        if (!read || read.err !== 0 || !read.data) return null;
        return {
          id: "recovery-" + descriptor.fileName, sourceType: "recovery-snapshot", sourceLabel: "task-snapshot", fileName: descriptor.fileName,
          path: path, localPath: path, width: descriptor.width, height: descriptor.height, mimeType: descriptor.mimeType,
          bounds: copyBounds(descriptor.bounds), documentBounds: copyBounds(descriptor.documentBounds), originalSourceType: descriptor.originalSourceType || null,
          base64: read.data, apiValue: read.data, previewSource: fileUrl(path), transient: false
        };
      } catch (error) { return null; }
    }
    restoreSnapshot(taskId) {
      if (!taskId || !this.cepFs) return null;
      try {
        var folder = this.taskPath(taskId), slash = separator(folder);
        var read = this.cepFs.readFile(folder + slash + "metadata.json");
        if (!read || read.err !== 0 || !read.data) return null;
        var metadata;
        try { metadata = JSON.parse(String(read.data).replace(/^\uFEFF/, "")); } catch (error) { return null; }
        if (!metadata || String(metadata.taskId) !== String(taskId)) return null;
        var main = this.readImage(folder, metadata.mainImage);
        var refs = (metadata.referenceImages || []).map((descriptor) => this.readImage(folder, descriptor)).filter(Boolean);
        var expected = (metadata.mainImage ? 1 : 0) + (metadata.referenceImages || []).length;
        var restored = { metadata: metadata, mainImage: main, referenceImages: refs, imagesMissing: expected !== (main ? 1 : 0) + refs.length };
        logging.logger.info("RECOVERY_SNAPSHOT_RESTORED", { provider: metadata.providerId, model: metadata.modelId,
          mainImageCount: main ? 1 : 0, referenceCount: refs.length, imagesMissing: restored.imagesMissing });
        return restored;
      } catch (error) {
        logging.logger.warn("Recovery snapshot skipped", { message: error && error.message });
        return null;
      }
    }
  }

  return { GenerationRecoveryStore: GenerationRecoveryStore, RECOVERY_RETENTION_MS: RETENTION_MS, recoveryFileUrl: fileUrl, safeRecoveryFolderName: safeFolderName };
}));
