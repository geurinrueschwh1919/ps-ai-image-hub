(function defineAutoSharpenManager(root, factory) {
  "use strict";
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(root, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAutoSharpenManager(root, logging) {
  "use strict";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.preferences.v1";
  var DEFAULT_PREFERENCES = Object.freeze({
    mode: "off",
    microRadius: 0.5,
    customBlendMode: "linearLight",
    customOpacity: 100,
    customRadiusMode: "auto",
    customManualRadius: 0.5,
    suppressColorFringing: false
  });
  var MODES = Object.freeze({
    off: Object.freeze({ id: "off", blendMode: "none", opacity: 0 }),
    micro: Object.freeze({ id: "micro", blendMode: "linearLight", opacity: 100 }),
    natural: Object.freeze({ id: "natural", blendMode: "overlay", opacity: 30 }),
    standard: Object.freeze({ id: "standard", blendMode: "linearLight", opacity: 18 }),
    strong: Object.freeze({ id: "strong", blendMode: "linearLight", opacity: 28 }),
    custom: Object.freeze({ id: "custom", blendMode: "linearLight", opacity: 100 })
  });
  var BLEND_MODES = Object.freeze(["softLight", "overlay", "linearLight"]);

  function normalizeMode(value) { return Object.prototype.hasOwnProperty.call(MODES, value) ? value : "off"; }
  function isEnabledMode(value) { return normalizeMode(value) !== "off"; }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function roundTenth(value) { return Math.round(Number(value) * 10) / 10; }
  function normalizeNumber(value, fallback, minimum, maximum, oneDecimal) {
    var parsed = Number(value);
    if (!isFinite(parsed)) parsed = fallback;
    parsed = clamp(parsed, minimum, maximum);
    return oneDecimal ? roundTenth(parsed) : Math.round(parsed);
  }
  function normalizeBlendMode(value) { return BLEND_MODES.indexOf(value) !== -1 ? value : DEFAULT_PREFERENCES.customBlendMode; }
  function normalizePreferences(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      mode: normalizeMode(source.mode),
      microRadius: normalizeNumber(source.microRadius, DEFAULT_PREFERENCES.microRadius, 0.1, 3.0, true),
      customBlendMode: normalizeBlendMode(source.customBlendMode),
      customOpacity: normalizeNumber(source.customOpacity, DEFAULT_PREFERENCES.customOpacity, 0, 100, false),
      customRadiusMode: source.customRadiusMode === "manual" ? "manual" : "auto",
      customManualRadius: normalizeNumber(source.customManualRadius, DEFAULT_PREFERENCES.customManualRadius, 0.1, 10.0, true),
      suppressColorFringing: source.suppressColorFringing === true
    };
  }
  function buildUiState(mode, preferences) {
    var effectiveMode = normalizeMode(mode);
    var saved = normalizePreferences(preferences);
    var sharpeningEnabled = isEnabledMode(effectiveMode);
    return {
      effectiveMode: effectiveMode,
      sharpeningEnabled: sharpeningEnabled,
      suppressColorFringingChecked: sharpeningEnabled && saved.suppressColorFringing,
      suppressColorFringingDisabled: !sharpeningEnabled,
      microControlsDisabled: effectiveMode !== "micro",
      customControlsDisabled: effectiveMode !== "custom",
      savedSuppressColorFringing: saved.suppressColorFringing
    };
  }
  function radiusForSize(width, height) {
    var shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
    return clamp(shortEdge / 1400, 0.7, 3.0);
  }
  function edgeProtectionForSize(width, height) {
    var shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
    if (shortEdge < 512) return { contract: 8, feather: 8 };
    if (shortEdge <= 1024) return { contract: 14, feather: 14 };
    if (shortEdge <= 2048) return { contract: 24, feather: 24 };
    return { contract: 40, feather: 40 };
  }
  function dimensionsFromItem(item, context) {
    var bounds = item && item.finalBounds || context && context.finalBounds || {};
    var width = Number(bounds.width) || Number(context && context.originalWidth) || 0;
    var height = Number(bounds.height) || Number(context && context.originalHeight) || 0;
    return { width: width, height: height };
  }
  function buildPlan(mode, dimensions, isLocal, preferences) {
    var normalized = normalizeMode(mode);
    var preset = MODES[normalized];
    var saved = normalizePreferences(preferences);
    var size = dimensions || {};
    var edge = edgeProtectionForSize(size.width, size.height);
    var radius = radiusForSize(size.width, size.height);
    var blendMode = preset.blendMode;
    var opacity = preset.opacity;
    if (normalized === "micro") radius = saved.microRadius;
    if (normalized === "custom") {
      radius = saved.customRadiusMode === "manual" ? saved.customManualRadius : radius;
      blendMode = saved.customBlendMode;
      opacity = saved.customOpacity;
    }
    return {
      enabled: normalized !== "off",
      mode: normalized,
      blendMode: blendMode,
      opacity: opacity,
      radius: radius,
      suppressColorFringing: saved.suppressColorFringing,
      isLocal: isLocal === true,
      contract: isLocal === true ? edge.contract : 0,
      feather: isLocal === true ? edge.feather : 0
    };
  }

  class AutoSharpenPreferenceStore {
    constructor(options) {
      this.storage = options && options.storage || root.localStorage;
    }
    getPreferences() {
      try { return normalizePreferences(JSON.parse(this.storage && this.storage.getItem(STORAGE_KEY) || "null")); }
      catch (error) { return normalizePreferences(null); }
    }
    setPreferences(patch) {
      var current = this.getPreferences();
      var updates = patch && typeof patch === "object" ? patch : {};
      Object.keys(updates).forEach(function assign(key) { current[key] = updates[key]; });
      var normalized = normalizePreferences(current);
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
    getMode() { return this.getPreferences().mode; }
    setMode(mode) { return this.setPreferences({ mode: mode }).mode; }
  }

  class AutoSharpenManager {
    constructor(options) {
      this.photoshopBridge = options && options.photoshopBridge || null;
      this.preferenceStore = options && options.preferenceStore || null;
    }
    getPreferences() { return this.preferenceStore ? this.preferenceStore.getPreferences() : normalizePreferences(null); }
    setPreferences(patch) { return this.preferenceStore ? this.preferenceStore.setPreferences(patch) : normalizePreferences(patch); }
    getMode() { return this.getPreferences().mode; }
    setMode(mode) { return this.setPreferences({ mode: mode }).mode; }
    isModeEnabled(mode) { return isEnabledMode(mode); }
    async applyToImportedLayer(item, settings) {
      var options = settings || {};
      var mode = normalizeMode(options.mode);
      if (!isEnabledMode(mode)) {
        return { applied: false, success: false, skipped: true, reason: "sharpening-disabled" };
      }
      if (!item || !item.layerName || !this.photoshopBridge || typeof this.photoshopBridge.applyAutoSharpen !== "function") {
        return { applied: false, skipped: "unavailable" };
      }
      var dimensions = dimensionsFromItem(item, options.importContext);
      var plan = buildPlan(mode, dimensions, options.isLocal === true, options.preferences || this.getPreferences());
      if (Number(item.documentId) >= 0 && Number(item.layerId) >= 0 && item.documentId !== undefined && item.documentId !== null && item.layerId !== undefined && item.layerId !== null) {
        plan.targetDocumentId = Number(item.documentId); plan.targetLayerId = Number(item.layerId);
      }
      try {
        var result = await this.photoshopBridge.applyAutoSharpen(item.layerName, plan);
        logging.logger.info("AUTO_SHARPEN_APPLIED", {
          diagnosticsId: "compat", mode: plan.mode, radius: plan.radius, opacity: plan.opacity,
          blendMode: plan.blendMode, suppressColorFringing: plan.suppressColorFringing,
          isLocal: plan.isLocal, contract: plan.contract, feather: plan.feather,
          replacedExisting: Boolean(result && result.replacedExisting)
        });
        return Object.assign({ applied: true, plan: plan }, result || {});
      } catch (error) {
        logging.logger.warn("AUTO_SHARPEN_FAILED", {
          diagnosticsId: "compat", mode: plan.mode, isLocal: plan.isLocal,
          errorName: String(error && error.name || "Error"), errorMessage: String(error && error.message || error || "Unknown error").slice(0, 300)
        });
        return { applied: false, failed: true, plan: plan, reason: error && error.code === "AUTO_SHARPEN_LAYER_MISSING" ? "target-layer-missing" : error && error.code === "AUTO_SHARPEN_DOCUMENT_INACTIVE" ? "target-document-inactive" : "sharpen-failed", message: "图片已成功导入，但自动清晰化未完成。" };
      }
    }
  }

  return {
    AutoSharpenManager: AutoSharpenManager,
    AutoSharpenPreferenceStore: AutoSharpenPreferenceStore,
    AUTO_SHARPEN_STORAGE_KEY: STORAGE_KEY,
    AUTO_SHARPEN_DEFAULT_PREFERENCES: DEFAULT_PREFERENCES,
    AUTO_SHARPEN_MODES: MODES,
    AUTO_SHARPEN_BLEND_MODES: BLEND_MODES,
    normalizeAutoSharpenMode: normalizeMode,
    isAutoSharpenEnabledMode: isEnabledMode,
    normalizeAutoSharpenPreferences: normalizePreferences,
    buildAutoSharpenUiState: buildUiState,
    calculateAutoSharpenRadius: radiusForSize,
    calculateAutoSharpenEdgeProtection: edgeProtectionForSize,
    buildAutoSharpenPlan: buildPlan
  };
}));
