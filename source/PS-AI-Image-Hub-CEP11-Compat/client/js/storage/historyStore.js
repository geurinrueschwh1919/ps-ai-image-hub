(function defineHistoryStore(root, factory) {
  "use strict";
  var base64 = typeof module === "object" && module.exports ? require("../utils/base64") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(base64, logging, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createHistoryStore(base64, logging, root) {
  "use strict";
  var DEFAULT_MAX_HISTORY_COUNT = 100;
  var HISTORY_CAPACITY_OPTIONS = Object.freeze([50, 100, 200, 500]);
  var HISTORY_PREFERENCES_KEY = "ps-ai-image-hub.compat.cep11.history.preferences.v1";

  function safeText(value, maxLength) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .slice(0, maxLength || 2000);
  }

  function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizedCapacity(value, fallback) {
    var number = Number(value);
    return HISTORY_CAPACITY_OPTIONS.indexOf(number) !== -1 ? number : fallback;
  }

  function defaultThumbnailCreator(payload) {
    if (!payload || !payload.base64 || !root.document || typeof root.Image !== "function") return Promise.resolve(null);
    return new Promise(function create(resolve) {
      var image = new root.Image();
      image.onload = function loaded() {
        try {
          var maximum = 320;
          var scale = Math.min(1, maximum / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
          var canvas = root.document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), extension: "jpg" });
        } catch (error) { resolve(null); }
      };
      image.onerror = function failed() { resolve(null); };
      image.src = "data:" + (payload.mimeType || "image/png") + ";base64," + payload.base64;
    });
  }

  function finiteNumber(value) { var number = Number(value); return isFinite(number) ? number : null; }

  function safeBounds(value) {
    if (!value) return null;
    var left = finiteNumber(value.left), top = finiteNumber(value.top), width = finiteNumber(value.width), height = finiteNumber(value.height);
    if (left === null || top === null || !(width > 0 && height > 0)) return null;
    return { left: left, top: top, right: left + width, bottom: top + height, width: width, height: height };
  }

  function sanitizeImportContext(value) {
    if (!value || typeof value !== "object") return null;
    return {
      importSizingEnabled: value.importSizingEnabled === true,
      importPathType: safeText(value.importPathType || "original", 40),
      targetBounds: safeBounds(value.targetBounds),
      targetWidth: finiteNumber(value.targetWidth), targetHeight: finiteNumber(value.targetHeight),
      originalWidth: finiteNumber(value.originalWidth), originalHeight: finiteNumber(value.originalHeight),
      calculatedScale: finiteNumber(value.calculatedScale), appliedScale: finiteNumber(value.appliedScale),
      resizeApplied: value.resizeApplied === true, upscalePrevented: value.upscalePrevented === true,
      alignmentAnchor: safeText(value.alignmentAnchor || "center", 40), fitMode: safeText(value.fitMode || "fit", 40),
      documentWidth: finiteNumber(value.documentWidth), documentHeight: finiteNumber(value.documentHeight),
      documentName: safeText(value.documentName, 240), mainSourceType: safeText(value.mainSourceType, 80),
      usedSmartObjectUpscale: value.usedSmartObjectUpscale === true,
      historyReimportUsedSavedContext: value.historyReimportUsedSavedContext === true,
      currentDocumentMatchesSavedImportContext: typeof value.currentDocumentMatchesSavedImportContext === "boolean"
        ? value.currentDocumentMatchesSavedImportContext : null,
      finalBounds: safeBounds(value.finalBounds)
    };
  }

  function statusForError(error) {
    var code = String(error && error.code || "");
    if (code === "CANCELLED") return "canceled-local";
    if (code === "ASYNC_REMOTE_CANCELED") return "canceled-remote";
    if (code === "GENERATION_TIMEOUT") return "timed-out";
    return "failed";
  }

  function terminalTransitionBlocked(oldStatus, newStatus) {
    if (oldStatus === "succeeded" && newStatus !== "succeeded") return true;
    if (oldStatus === "canceled-remote" && newStatus !== "canceled-remote") return true;
    return false;
  }

  class HistoryStore {
    constructor(options) {
      options = options || {};
      this.photoshopBridge = options.photoshopBridge;
      this.apiClient = options.apiClient;
      this.cepFs = options.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = options.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
      this.preferenceStorage = options.storage || null;
      this.explicitMaxHistoryCount = Number(options.maxHistoryCount) > 0;
      this.maxHistoryCount = this.explicitMaxHistoryCount ? Number(options.maxHistoryCount) : this.loadCapacity();
      this.thumbnailCreator = options.thumbnailCreator || defaultThumbnailCreator;
      this.explicitRoot = options.rootPath || null;
      this.entries = null;
    }
    loadCapacity() {
      try {
        var parsed = JSON.parse(this.preferenceStorage && this.preferenceStorage.getItem(HISTORY_PREFERENCES_KEY) || "null");
        return normalizedCapacity(parsed && parsed.maxHistoryCount, DEFAULT_MAX_HISTORY_COUNT);
      } catch (error) { return DEFAULT_MAX_HISTORY_COUNT; }
    }
    getMaxHistoryCount() { return this.maxHistoryCount; }
    setMaxHistoryCount(value) {
      var capacity = normalizedCapacity(value, this.maxHistoryCount);
      this.maxHistoryCount = capacity;
      if (this.preferenceStorage) this.preferenceStorage.setItem(HISTORY_PREFERENCES_KEY, JSON.stringify({ maxHistoryCount: capacity }));
      this.enforceCapacity();
      return capacity;
    }
    paths() {
      var userRoot = this.explicitRoot || this.photoshopBridge.getUserDataRoot();
      var slash = userRoot.indexOf("\\") !== -1 || /^[A-Za-z]:/.test(userRoot) ? "\\" : "/";
      var rootPath = userRoot + slash + "PSAIImageHubCompat" + slash + "history";
      return { root: rootPath, images: rootPath + slash + "images", originals: rootPath + slash + "originals",
        thumbnails: rootPath + slash + "thumbnails", file: rootPath + slash + "history.json", slash: slash };
    }
    ensureDirectories() {
      var paths = this.paths();
      [paths.root, paths.images, paths.originals, paths.thumbnails].forEach((path) => { var result = this.cepFs.makedir(path); if (result && result.err !== 0 && (!this.cepFs.stat || this.cepFs.stat(path).err !== 0)) throw new Error("Could not create history directory."); });
      return paths;
    }
    load() {
      if (this.entries) return copy(this.entries);
      this.entries = [];
      if (!this.cepFs || typeof this.cepFs.readFile !== "function") return [];
      try {
        var result = this.cepFs.readFile(this.paths().file);
        if (!result || result.err !== 0 || !result.data) return [];
        var parsed = JSON.parse(result.data); if (Array.isArray(parsed)) this.entries = parsed.map(function normalizeEntry(entry) {
          var normalized = entry && typeof entry === "object" ? entry : {};
          normalized.favorite = normalized.favorite === true;
          return normalized;
        });
      } catch (error) { this.entries = []; }
      return copy(this.entries);
    }
    write() {
      var paths = this.ensureDirectories();
      var result = this.cepFs.writeFile(paths.file, JSON.stringify(this.entries || [], null, 2));
      if (!result || result.err !== 0) throw new Error("Could not write generation history.");
    }
    async imageBase64(image) {
      var source = image && image.importSource;
      if (!source) return null;
      if (source.type === "url") {
        var downloaded = await this.apiClient.requestArrayBuffer(source.url, { timeoutContext: "download" });
        return { base64: base64.bytesToBase64(downloaded.bytes), bytes: new Uint8Array(downloaded.bytes), mimeType: downloaded.mimeType || null };
      }
      if (source.type === "base64" || source.type === "data-url") return base64.base64ToBytes(source.data || source.dataUrl || "");
      var localPath = source.type === "plugin-asset" ? this.photoshopBridge.resolveExtensionAsset(source.relativePath) : source.type === "local-file" ? source.path : null;
      if (!localPath) return null;
      var read = this.cepFs.readFile(localPath, this.base64Encoding);
      if (!read || read.err !== 0 || !read.data) return null;
      return base64.base64ToBytes(read.data);
    }
    async persistAssets(entryId, image) {
      var payload = await this.imageBase64(image);
      var detected = payload && base64.detectImageMimeType(payload.bytes);
      var declared = payload && base64.canonicalImageMimeType(payload.mimeType);
      if (!payload || ["image/png", "image/jpeg"].indexOf(detected) === -1) return { original: null, originalMimeType: null, thumbnail: null };
      if (declared && declared !== "application/octet-stream" && declared !== detected) return { original: null, originalMimeType: null, thumbnail: null };
      if (!base64.hasCompleteImageSignature(payload.bytes, detected)) return { original: null, originalMimeType: null, thumbnail: null };
      payload.mimeType = detected;
      var paths = this.ensureDirectories();
      var originalPath = paths.originals + paths.slash + entryId + (detected === "image/jpeg" ? ".jpg" : ".png");
      var result = this.cepFs.writeFile(originalPath, payload.base64, this.base64Encoding);
      if (!result || result.err !== 0) return { original: null, thumbnail: null };
      var thumbnail = null;
      try { thumbnail = await this.thumbnailCreator(payload); } catch (error) { thumbnail = null; }
      var thumbnailPath = null;
      if (thumbnail && thumbnail.base64) {
        thumbnailPath = paths.thumbnails + paths.slash + entryId + "." + (thumbnail.extension === "png" ? "png" : "jpg");
        result = this.cepFs.writeFile(thumbnailPath, thumbnail.base64, this.base64Encoding);
        if (!result || result.err !== 0) thumbnailPath = null;
      }
      return { original: originalPath, originalMimeType: detected, thumbnail: thumbnailPath };
    }
    async persistImage(entryId, image) { return (await this.persistAssets(entryId, image)).original; }
    async ensureThumbnail(id) {
      this.load();
      var entry = this.entries.find(function match(item) { return item.id === id; });
      if (!entry || !entry.localResultFile) return null;
      if (entry.thumbnail && entry.thumbnail !== entry.localResultFile) return entry.thumbnail;
      var read = this.cepFs.readFile(entry.localResultFile, this.base64Encoding);
      if (!read || read.err !== 0 || !read.data) return null;
      var thumbnail = null;
      var originalPayload = base64.base64ToBytes(read.data);
      originalPayload.mimeType = entry.localResultMimeType || base64.detectImageMimeType(originalPayload.bytes);
      try { thumbnail = await this.thumbnailCreator(originalPayload); } catch (error) { thumbnail = null; }
      if (!thumbnail || !thumbnail.base64) return null;
      var paths = this.ensureDirectories();
      var thumbnailPath = paths.thumbnails + paths.slash + entry.id + "." + (thumbnail.extension === "png" ? "png" : "jpg");
      var result = this.cepFs.writeFile(thumbnailPath, thumbnail.base64, this.base64Encoding);
      if (!result || result.err !== 0) return null;
      entry.thumbnail = thumbnailPath; this.write(); return thumbnailPath;
    }
    baseEntry(input, result, status, identity) {
      var now = new Date();
      var providerId = result && result.providerId || input && input.providerId || "";
      var modelId = result && result.modelId || input && input.modelId || "";
      var providerMetadata = input && input.providerMetadata || {};
      var presetMetadata = input && input.presetMetadata || {};
      var presetIds = (Array.isArray(presetMetadata.presetIds) ? presetMetadata.presetIds : []).slice(0, 20).map(function id(value) { return safeText(value, 160); }).filter(Boolean);
      var presetTitles = (Array.isArray(presetMetadata.presetTitles) ? presetMetadata.presetTitles : []).slice(0, 20).map(function title(value) { return safeText(value, 200); }).filter(Boolean);
      var owner = identity || {};
      return {
        id: safeText(owner.historyId || "history-" + now.getTime() + "-" + Math.floor(Math.random() * 100000), 240),
        executionId: safeText(owner.executionId, 240), createdAt: safeText(owner.createdAt || now.toISOString(), 80),
        provider: safeText(providerId, 120), providerDisplayName: safeText(input && input.providerDisplayName || providerId, 160),
        modelId: safeText(modelId, 160), displayName: safeText(input && input.modelDisplayName || modelId, 160),
        prompt: safeText(input && (input.finalPrompt || input.prompt) || result && result.prompt, 4000),
        finalPrompt: safeText(input && (input.finalPrompt || input.prompt) || result && result.prompt, 4000),
        region: safeText(providerMetadata.region, 80), endpointMode: safeText(providerMetadata.endpointMode, 40),
        dedicatedApiHostFingerprint: safeText(providerMetadata.dedicatedApiHost ? "configured" : "", 32),
        providerConfigRevision: Number(providerMetadata.providerConfigRevision) || 0,
        hasMainImage: Boolean(input && input.imageInputs && input.imageInputs.mainImage),
        mainImageCount: input && input.imageInputs && input.imageInputs.mainImage ? 1 : 0,
        referenceImageCount: input && input.imageInputs && Array.isArray(input.imageInputs.referenceImages) ? input.imageInputs.referenceImages.length : 0,
        aspectRatio: safeText(input && input.aspectRatio, 60), imageSize: safeText(input && input.imageSize, 60),
        outputSize: safeText(input && (input.outputSize || input.resolutionTier || input.imageSize), 60),
        presetIds: presetIds, presetTitles: presetTitles, quality: safeText(input && input.quality, 60),
        negativePrompt: safeText(input && input.negativePrompt, 4000),
        promptExtend: input && input.promptExtend !== undefined ? input.promptExtend !== false : null,
        promptExtendMode: safeText(input && input.promptExtendMode, 40),
        enableThinking: input && input.enableThinking !== undefined ? input.enableThinking !== false : null,
        seed: safeText(input && input.seed, 40),
        taskId: safeText(result && result.taskId || owner.taskId, 240), status: status, generationStatus: status,
        importStatus: result && result.importState || "notImported", resultUrl: "", localResultFile: null, localResultMimeType: null, thumbnail: null,
        importedToPhotoshop: Boolean(result && result.importState === "imported"),
        importContext: sanitizeImportContext(result && result.importResult && result.importResult.importContext), favorite: false,
        errorCode: null, errorMessage: null
      };
    }
    add(entry) {
      this.load(); var snapshot = copy(entry); this.entries.unshift(snapshot); this.write(); this.enforceCapacity(); return copy(snapshot);
    }
    enforceCapacity() {
      this.load();
      var ordinary = this.entries.filter(function normal(entry) { return entry.favorite !== true; });
      var removeIds = [];
      while (ordinary.length > this.maxHistoryCount) removeIds.push(ordinary.pop().id);
      if (removeIds.length) this.removeEntries(removeIds);
      return this.load();
    }
    findByExecution(executionId) {
      this.load();
      var entry = this.entries.find(function match(item) { return item.executionId === String(executionId || ""); });
      return entry ? copy(entry) : null;
    }
    beginExecution(input, identity) {
      var owner = identity || {};
      this.load();
      var existing = this.entries.find(function match(item) {
        return item.id === String(owner.historyId || "") && item.executionId === String(owner.executionId || "");
      });
      if (existing) return copy(existing);
      return this.add(this.baseEntry(input, { taskId: owner.taskId }, owner.status || "submitting", owner));
    }
    writeExecutionStatus(identity, update) {
      var owner = identity || {}, patch = update || {};
      this.load();
      var entry = this.entries.find(function match(item) { return item.id === String(owner.historyId || ""); });
      if (!entry || !owner.executionId || entry.executionId !== String(owner.executionId)) {
        logging.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
          executionId: safeText(owner.executionId, 240), historyId: safeText(owner.historyId, 240),
          requestedStatus: safeText(patch.status, 80)
        });
        return false;
      }
      var oldStatus = entry.status;
      var nextStatus = safeText(patch.status || oldStatus, 80);
      if (terminalTransitionBlocked(oldStatus, nextStatus)) {
        logging.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
          executionId: entry.executionId, historyId: entry.id, oldStatus: oldStatus, requestedStatus: nextStatus
        });
        return false;
      }
      Object.keys(patch).forEach(function apply(name) { entry[name] = copy(patch[name]); });
      entry.status = nextStatus;
      entry.generationStatus = safeText(patch.generationStatus || nextStatus, 80);
      this.write();
      logging.logger.info("HISTORY_STATUS_WRITE", {
        executionId: entry.executionId, historyId: entry.id, oldStatus: oldStatus, newStatus: entry.status
      });
      return copy(entry);
    }
    async recordSuccess(input, result, identity) {
      var entry = this.baseEntry(input, result, "succeeded", identity);
      if (identity && identity.executionId && identity.historyId) {
        var owned = this.findByExecution(identity.executionId);
        if (owned && owned.id !== String(identity.historyId)) {
          this.writeExecutionStatus(identity, { status: "succeeded" });
          return false;
        }
        if (!owned) this.beginExecution(input, identity);
      }
      var first = result && result.images && result.images[0];
      entry.resultUrl = first && first.importSource && first.importSource.type === "url" ? safeText(first.importSource.url, 2000) : "";
      if (first) {
        var assets = await this.persistAssets(entry.id, first);
        entry.localResultFile = assets.original; entry.localResultMimeType = assets.originalMimeType; entry.thumbnail = assets.thumbnail;
      }
      if (identity && identity.executionId && identity.historyId) {
        return this.writeExecutionStatus(identity, {
          status: "succeeded", generationStatus: "succeeded", importStatus: result && result.importState || "notImported",
          provider: entry.provider, providerDisplayName: entry.providerDisplayName, modelId: entry.modelId, displayName: entry.displayName, prompt: entry.prompt,
          finalPrompt: entry.finalPrompt,
           region: entry.region, endpointMode: entry.endpointMode,
           dedicatedApiHostFingerprint: entry.dedicatedApiHostFingerprint,
           providerConfigRevision: entry.providerConfigRevision,
          hasMainImage: entry.hasMainImage, referenceImageCount: entry.referenceImageCount,
          mainImageCount: entry.mainImageCount, aspectRatio: entry.aspectRatio, imageSize: entry.imageSize,
          outputSize: entry.outputSize, presetIds: entry.presetIds, presetTitles: entry.presetTitles, quality: entry.quality,
          negativePrompt: entry.negativePrompt, promptExtend: entry.promptExtend,
          promptExtendMode: entry.promptExtendMode, enableThinking: entry.enableThinking, seed: entry.seed,
          taskId: entry.taskId, resultUrl: entry.resultUrl, localResultFile: entry.localResultFile, localResultMimeType: entry.localResultMimeType,
          thumbnail: entry.thumbnail, importedToPhotoshop: entry.importedToPhotoshop,
          importContext: entry.importContext,
          errorCode: null, errorMessage: null
        });
      }
      return this.add(entry);
    }
    recordFailure(input, error, identity) {
      var status = statusForError(error);
      var result = identity && identity.taskId ? { taskId: identity.taskId } : null;
      var entry = this.baseEntry(input, result, status, identity);
      entry.errorCode = safeText(error && error.code || "UNKNOWN", 120);
      entry.errorMessage = safeText(error && error.message || "Generation failed.", 500);
      if (identity && identity.executionId && identity.historyId) {
        if (!this.findByExecution(identity.executionId)) this.beginExecution(input, identity);
        return this.writeExecutionStatus(identity, {
          status: status, generationStatus: status, taskId: entry.taskId,
          errorCode: entry.errorCode, errorMessage: entry.errorMessage
        });
      }
      return this.add(entry);
    }
    removeEntries(ids) {
      this.load();
      var targets = Array.isArray(ids) ? ids.map(String) : [];
      var removedEntries = this.entries.filter(function remove(entry) { return targets.indexOf(String(entry.id)) !== -1; });
      if (!removedEntries.length) return false;
      var before = copy(this.entries), backups = [], paths = [];
      removedEntries.forEach(function collect(removed) {
        [removed.localResultFile, removed.thumbnail].forEach(function unique(path) { if (path && paths.indexOf(path) === -1) paths.push(path); });
      });
      try {
        paths.forEach((path) => { var read = this.cepFs.readFile(path, this.base64Encoding); if (read && read.err === 0) backups.push({ path: path, data: read.data }); });
        this.entries = this.entries.filter(function keep(entry) { return targets.indexOf(String(entry.id)) === -1; }); this.write();
        paths.forEach((path) => { var result = this.cepFs.deleteFile && this.cepFs.deleteFile(path); if (result && result.err !== 0) throw new Error("Could not delete history image."); });
        return true;
      } catch (error) {
        this.entries = before;
        backups.forEach((backup) => { this.cepFs.writeFile(backup.path, backup.data, this.base64Encoding); });
        try { this.write(); } catch (restoreError) { /* Keep the in-memory rollback even if disk recovery fails. */ }
        return false;
      }
    }
    delete(id) { return this.removeEntries([id]); }
    setFavorite(id, favorite) {
      this.load(); var entry = this.entries.find(function match(item) { return item.id === id; });
      if (!entry) return false; entry.favorite = favorite === true; this.write(); if (!entry.favorite) this.enforceCapacity(); return copy(entry);
    }
    markImported(id, importContext) {
      this.load(); var entry = this.entries.find(function match(item) { return item.id === id; });
      if (!entry) return false; entry.importedToPhotoshop = true; entry.importStatus = "imported";
      if (importContext && (!entry.importContext || importContext.historyReimportUsedSavedContext !== true)) {
        entry.importContext = sanitizeImportContext(importContext);
      }
      this.write(); return true;
    }
    clearImageReferences() {
      this.load();
      this.entries.forEach(function clear(entry) { entry.localResultFile = null; entry.thumbnail = null; });
      this.write();
    }
    clear() {
      this.load(); return this.removeEntries(this.entries.map(function id(entry) { return entry.id; }));
    }
  }

  return { HistoryStore: HistoryStore, DEFAULT_MAX_HISTORY_COUNT: DEFAULT_MAX_HISTORY_COUNT,
    HISTORY_CAPACITY_OPTIONS: HISTORY_CAPACITY_OPTIONS, HISTORY_PREFERENCES_KEY: HISTORY_PREFERENCES_KEY,
    sanitizeHistoryText: safeText, sanitizeHistoryImportContext: sanitizeImportContext };
}));
