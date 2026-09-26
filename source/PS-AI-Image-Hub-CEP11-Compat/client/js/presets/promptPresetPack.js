(function definePromptPresetPack(root, factory) {
  "use strict";
  var parser = typeof module === "object" && module.exports ? require("./promptPresetParser") : root.PSAIImageHubCompat;
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(parser, normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetPack(parser, normalizer) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;
  var SINGLE_MAX_BYTES = 2 * 1024 * 1024;
  var PACK_MAX_BYTES = 10 * 1024 * 1024;
  var PRESET_MAX_BYTES = 2 * 1024 * 1024;
  var MAX_PRESETS = 500;
  var SAFE_FIELDS = ["id", "title", "category", "subCategory", "refImages", "description", "version", "recommendedMode", "requiresMainImage",
    "supportsReferenceImages", "recommendedApplyMode", "applyModeDefault", "recommendedReferenceCount", "usageHint",
    "coreRules", "fixedRules", "factory", "controls", "fields", "toggles", "promptTemplate", "negativePromptTemplate",
    "sourceKind", "sourceText", "structuredContent", "markerModules", "metadata", "localDisplayName"];

  function byteLength(value) {
    var source = String(value || ""), bytes = 0;
    for (var index = 0; index < source.length; index += 1) {
      var code = source.charCodeAt(index);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < source.length) { bytes += 4; index += 1; }
      else bytes += 3;
    }
    return bytes;
  }
  function isSensitiveKey(key) { return /api.?key|authorization|bearer|token|secret|password|base64|image.?data/i.test(String(key || "")); }
  function safeData(value, depth) {
    if (depth > 10 || value === null || value === undefined) return value === null ? null : undefined;
    if (typeof value === "string") {
      if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim())) return undefined;
      return value.length > 1000000 ? value.slice(0, 1000000) : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 500).map(function item(entry) { return safeData(entry, depth + 1); });
    if (typeof value !== "object") return undefined;
    var output = {};
    Object.keys(value).forEach(function property(key) {
      if (isSensitiveKey(key)) return;
      var cleaned = safeData(value[key], depth + 1);
      if (cleaned !== undefined) output[key] = cleaned;
    });
    return output;
  }
  function exportablePreset(preset) {
    var output = {};
    SAFE_FIELDS.forEach(function field(name) {
      if (preset && preset[name] !== undefined && !isSensitiveKey(name)) output[name] = safeData(preset[name], 0);
    });
    if (!output.id || !output.title) throw new PromptPresetError(CODES.REQUIRED_FIELD, "Preset ID and title are required for export.");
    var serialized = JSON.stringify(output);
    if (byteLength(serialized) > PRESET_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "A preset exceeds the 2 MB limit.");
    return output;
  }
  function parseJson(text) {
    try { return JSON.parse(text); }
    catch (error) { throw new PromptPresetError(CODES.JSON_INVALID, "Preset JSON could not be parsed."); }
  }
  function parsePromptPresetImport(text, options) {
    var source = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!source) throw new PromptPresetError(CODES.EMPTY, "Preset file is empty.");
    var size = byteLength(source);
    if (size > PACK_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "Preset Pack exceeds the 10 MB limit.");
    var parsed = parseJson(source), inputs, isPack = false;
    if (parsed && parsed.format === "PSAIImageHubPresetPack") {
      if (Number(parsed.version) !== 1 || !Array.isArray(parsed.presets)) throw new PromptPresetError(CODES.PACK_INVALID, "Preset Pack structure is invalid.");
      inputs = parsed.presets; isPack = true;
    } else if (Array.isArray(parsed)) inputs = parsed;
    else inputs = [parsed];
    if (!inputs.length) throw new PromptPresetError(CODES.UNSUPPORTED, "Preset file contains no presets.");
    if (inputs.length > MAX_PRESETS) throw new PromptPresetError(CODES.LIMIT_EXCEEDED, "Preset Pack contains more than 500 presets.");
    if (!isPack && inputs.length === 1 && size > SINGLE_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "Preset file exceeds the 2 MB limit.");
    var settings = options || {};
    var presets = inputs.map(function normalize(item, index) {
      if (byteLength(JSON.stringify(item)) > PRESET_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "A preset exceeds the 2 MB limit.", { index: index });
      return parser.parsePromptPreset(item, { fileName: settings.fileName });
    });
    return { presets: presets, isPack: isPack, count: presets.length };
  }
  function exportPromptPreset(preset) { return JSON.stringify(exportablePreset(preset), null, 2) + "\n"; }
  function exportPromptPresetPack(presets) {
    var list = Array.isArray(presets) ? presets : [];
    if (list.length > MAX_PRESETS) throw new PromptPresetError(CODES.LIMIT_EXCEEDED, "Preset Pack contains more than 500 presets.");
    var output = JSON.stringify({ format: "PSAIImageHubPresetPack", version: 1,
      exportedAt: new Date().toISOString(), presets: list.map(exportablePreset) }, null, 2) + "\n";
    if (byteLength(output) > PACK_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "Preset Pack exceeds the 10 MB limit.");
    return output;
  }
  function safePresetFileName(value, fallback) {
    var name = String(value || fallback || "prompt-preset").replace(/\.json$/i, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "").slice(0, 100);
    return (name || "prompt-preset") + ".json";
  }

  return {
    parsePromptPresetImport: parsePromptPresetImport,
    exportPromptPreset: exportPromptPreset,
    exportPromptPresetPack: exportPromptPresetPack,
    sanitizePromptPresetForExport: exportablePreset,
    promptPresetUtf8ByteLength: byteLength,
    safePromptPresetFileName: safePresetFileName,
    PROMPT_PRESET_SINGLE_MAX_BYTES: SINGLE_MAX_BYTES,
    PROMPT_PRESET_PACK_MAX_BYTES: PACK_MAX_BYTES,
    PROMPT_PRESET_MAX_COUNT: MAX_PRESETS
  };
}));
