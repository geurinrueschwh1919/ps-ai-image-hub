(function definePromptPresetZip(root, factory) {
  "use strict";
  var pack = typeof module === "object" && module.exports ? require("./promptPresetPack") : root.PSAIImageHubCompat;
  var parser = typeof module === "object" && module.exports ? require("./promptPresetParser") : root.PSAIImageHubCompat;
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var fflate = typeof module === "object" && module.exports ? require("../../lib/fflate.min.js") : root.fflate;
  var api = factory(pack, parser, normalizer, fflate);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetZip(pack, parser, normalizer, fflate) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;
  var ZIP_MAX_BYTES = 10 * 1024 * 1024;
  var JSON_MAX_BYTES = 2 * 1024 * 1024;
  var MAX_JSON_FILES = 500;
  var MAX_LIBRARY_PRESETS = 500;

  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function bytes(value) { return value instanceof Uint8Array ? value : new Uint8Array(value || []); }
  function safePath(value) { return String(value || "").replace(/\\/g, "/").replace(/^\/+/, ""); }
  function isHiddenPath(value) {
    return safePath(value).split("/").some(function hidden(part) { return part === "__MACOSX" || part.charAt(0) === "."; });
  }
  function isJsonPath(value) {
    var path = safePath(value);
    return Boolean(path && !isHiddenPath(path) && !/\/$/.test(path) && /\.json$/i.test(path));
  }
  function hasEndOfCentralDirectory(value) {
    var minimum = Math.max(0, value.length - 65558);
    for (var index = value.length - 22; index >= minimum; index -= 1) {
      if (value[index] === 0x50 && value[index + 1] === 0x4B && value[index + 2] === 0x05 && value[index + 3] === 0x06) return true;
    }
    return false;
  }
  function fileName(value) { var parts = safePath(value).split("/"); return parts[parts.length - 1] || "preset.json"; }
  function failure(path, code, message) { return { path: safePath(path), code: String(code || CODES.JSON_INVALID), message: String(message || "Preset could not be imported.") }; }
  function sensitiveKey(value) { return /api.?key|authorization|bearer|token|secret|password|base64|image.?data/i.test(String(value || "")); }
  function sanitize(value, key, depth) {
    if (depth > 12 || value === undefined || value === null) return value === null ? null : undefined;
    if (sensitiveKey(key)) return undefined;
    if (typeof value === "string") {
      if (/^data:[^;,]+;base64,/i.test(value.trim())) return undefined;
      return value.length > 1000000 ? value.slice(0, 1000000) : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 500).map(function item(entry) { return sanitize(entry, "", depth + 1); }).filter(function present(entry) { return entry !== undefined; });
    if (typeof value !== "object") return undefined;
    var output = {};
    Object.keys(value).forEach(function property(name) {
      var cleaned = sanitize(value[name], name, depth + 1);
      if (cleaned !== undefined) output[name] = cleaned;
    });
    return output;
  }
  function sanitizePreset(preset) {
    var output = sanitize(preset, "", 0) || {};
    output.factory = false;
    if (output.sourceKind === "structured") output.sourceText = "";
    return output;
  }
  function fallbackText(raw) {
    if (typeof raw === "string") return raw;
    if (raw === null || raw === undefined) return "";
    if (typeof raw !== "object") return String(raw);
    var candidate = raw.content !== undefined ? raw.content : raw.prompt !== undefined ? raw.prompt : raw.text;
    if (typeof candidate === "string") {
      var stripped = candidate.split(/\r?\n/).filter(function keep(line) { return !/@param:|MODULE_START|MODULE_END/.test(line); }).join("\n").trim();
      return stripped || candidate;
    }
    try { return JSON.stringify(sanitize(raw, "", 0), null, 2); } catch (error) { return ""; }
  }
  function fallbackPreset(text, path, originalError) {
    var raw;
    try { raw = JSON.parse(String(text || "").replace(/^\uFEFF/, "")); } catch (error) { throw originalError; }
    var source = Array.isArray(raw) ? raw[0] : raw;
    var promptText = fallbackText(source);
    if (!promptText) throw originalError;
    return normalizer.normalizePromptPreset({
      id: source && typeof source === "object" ? source.id : "",
      title: source && typeof source === "object" ? source.title || source.name : "",
      category: source && typeof source === "object" ? source.category : "other",
      subCategory: source && typeof source === "object" ? source.subCategory : "",
      refImages: source && typeof source === "object" ? source.refImages : []
    }, { fileName: fileName(path), sourceText: promptText, sourceKind: "text" });
  }
  function parseEntry(text, path) {
    try { return pack.parsePromptPresetImport(text, { fileName: fileName(path) }).presets.map(sanitizePreset); }
    catch (error) {
      if (!error || [CODES.UNSUPPORTED, CODES.REQUIRED_FIELD, CODES.MARKER_INVALID, CODES.COMPILE_FAILED].indexOf(error.code) === -1) throw error;
      return [sanitizePreset(fallbackPreset(text, path, error))];
    }
  }
  function stable(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (typeof value !== "object") return JSON.stringify(value);
    return "{" + Object.keys(value).sort().map(function key(name) { return JSON.stringify(name) + ":" + stable(value[name]); }).join(",") + "}";
  }
  function fingerprint(preset) {
    var value = copy(preset) || {};
    delete value.id; delete value.title; delete value.localDisplayName; delete value.displayTitle; delete value.favorite; delete value.presetType;
    if (value.metadata) { delete value.metadata.importedFileName; if (!Object.keys(value.metadata).length) delete value.metadata; }
    return stable(value);
  }
  function isParameterized(preset) {
    return [].concat(preset && preset.controls || [], preset && preset.fields || [], preset && preset.toggles || []).some(function visible(item) {
      return item && item.type !== "hidden" && item.type !== "note" && item.type !== "section";
    });
  }
  function hasReferences(preset) { return Array.isArray(preset && preset.refImages) && preset.refImages.length > 0; }
  function isUnknownCategory(preset) {
    var original = String(preset && preset.metadata && preset.metadata.originalCategory || "").trim();
    if (!original) return true;
    var aliases = normalizer.PROMPT_PRESET_CATEGORY_ALIASES || {};
    if (aliases[original] || aliases[original.toLowerCase()]) return false;
    return normalizer.normalizePromptPresetCategory(original) === "other";
  }
  function analyze(presets, existing, maximum) {
    var virtual = (Array.isArray(existing) ? existing : []).map(copy), importable = [];
    var duplicateIds = 0, duplicateTitles = 0, exactDuplicates = 0;
    (presets || []).forEach(function inspect(preset) {
      var duplicateId = virtual.some(function sameId(item) { return item.id === preset.id; });
      var duplicateTitle = virtual.some(function sameTitle(item) { return item.title === preset.title; });
      if (duplicateId) duplicateIds += 1;
      if (duplicateTitle) duplicateTitles += 1;
      var presetFingerprint = fingerprint(preset);
      if (virtual.some(function identical(item) { return fingerprint(item) === presetFingerprint; })) { exactDuplicates += 1; return; }
      if (virtual.length >= maximum) return;
      importable.push(preset); virtual.push(preset);
    });
    return { importablePresets: importable, duplicateIdCount: duplicateIds, duplicateTitleCount: duplicateTitles, exactDuplicateCount: exactDuplicates };
  }

  function scanPromptPresetZip(input, options) {
    var zipBytes = bytes(input), settings = options || {};
    if (!fflate || typeof fflate.Unzip !== "function" || typeof fflate.UnzipInflate !== "function") {
      throw new PromptPresetError(CODES.ZIP_INVALID, "ZIP decompression component is unavailable.");
    }
    if (!zipBytes.length) throw new PromptPresetError(CODES.ZIP_INVALID, "ZIP file is empty.");
    if (zipBytes.length > ZIP_MAX_BYTES) throw new PromptPresetError(CODES.FILE_TOO_LARGE, "ZIP file exceeds the 10 MB limit.");
    if (!hasEndOfCentralDirectory(zipBytes)) throw new PromptPresetError(CODES.ZIP_INVALID, "ZIP file is damaged or incomplete.");
    var jsonFileCount = 0, ignoredFileCount = 0, presets = [], failures = [], openFiles = 0;
    var unzip = new fflate.Unzip(function onFile(file) {
      var path = safePath(file.name);
      if (!isJsonPath(path)) { ignoredFileCount += 1; return; }
      jsonFileCount += 1;
      if (jsonFileCount > MAX_JSON_FILES) return;
      if (Number(file.originalSize || 0) > JSON_MAX_BYTES) { failures.push(failure(path, CODES.FILE_TOO_LARGE, "JSON file exceeds the 2 MB limit.")); return; }
      var chunks = [], total = 0, finished = false; openFiles += 1;
      file.ondata = function onData(error, chunk, final) {
        if (finished) return;
        if (error) { finished = true; failures.push(failure(path, CODES.ZIP_INVALID, error.message)); openFiles -= 1; return; }
        if (chunk && chunk.length) { total += chunk.length; if (total <= JSON_MAX_BYTES) chunks.push(chunk); }
        if (!final) return;
        finished = true; openFiles -= 1;
        if (total > JSON_MAX_BYTES) { failures.push(failure(path, CODES.FILE_TOO_LARGE, "JSON file exceeds the 2 MB limit.")); return; }
        try {
          var joined = new Uint8Array(total), offset = 0;
          chunks.forEach(function join(part) { joined.set(part, offset); offset += part.length; });
          var text = fflate.strFromU8(joined);
          presets = presets.concat(parseEntry(text, path));
        } catch (parseError) { failures.push(failure(path, parseError && parseError.code, parseError && parseError.message)); }
      };
      try { file.start(); }
      catch (startError) { if (!finished) { finished = true; openFiles -= 1; failures.push(failure(path, CODES.ZIP_INVALID, startError.message)); } }
    });
    unzip.register(fflate.UnzipInflate);
    try { unzip.push(zipBytes, true); }
    catch (error) { throw new PromptPresetError(CODES.ZIP_INVALID, "ZIP file is damaged or unsupported.", { message: error && error.message }); }
    if (jsonFileCount > MAX_JSON_FILES) throw new PromptPresetError(CODES.LIMIT_EXCEEDED, "ZIP contains more than 500 JSON files.");
    if (openFiles !== 0) throw new PromptPresetError(CODES.ZIP_INVALID, "ZIP extraction did not finish.");
    var plan = analyze(presets, settings.existingPresets || [], Number(settings.libraryLimit || MAX_LIBRARY_PRESETS));
    return {
      archiveBytes: zipBytes.length,
      jsonFileCount: jsonFileCount,
      recognizedCount: presets.length,
      importableCount: plan.importablePresets.length,
      failureCount: failures.length,
      duplicateIdCount: plan.duplicateIdCount,
      duplicateTitleCount: plan.duplicateTitleCount,
      parameterizedCount: presets.filter(isParameterized).length,
      refImagesCount: presets.filter(hasReferences).length,
      unknownCategoryCount: presets.filter(isUnknownCategory).length,
      exactDuplicateCount: plan.exactDuplicateCount,
      ignoredFileCount: ignoredFileCount,
      presets: presets,
      importablePresets: plan.importablePresets,
      failures: failures
    };
  }
  function importPromptPresetZipScan(scan, registry) {
    if (!scan || !registry || typeof registry.register !== "function") throw new PromptPresetError(CODES.UNSUPPORTED, "Preset Registry is unavailable.");
    var added = [], skipped = Number(scan.exactDuplicateCount || 0), failed = [];
    (scan.importablePresets || []).forEach(function register(preset) {
      try { var item = registry.register(preset, { conflict: "copy" }); if (item) added.push(item); else skipped += 1; }
      catch (error) { failed.push({ id: preset && preset.id, code: error && error.code, message: error && error.message }); }
    });
    return { added: added, skipped: skipped, failed: failed };
  }

  return {
    scanPromptPresetZip: scanPromptPresetZip,
    importPromptPresetZipScan: importPromptPresetZipScan,
    isPromptPresetZipJsonPath: isJsonPath,
    promptPresetZipFingerprint: fingerprint,
    sanitizeZipImportedPreset: sanitizePreset,
    PROMPT_PRESET_ZIP_MAX_BYTES: ZIP_MAX_BYTES,
    PROMPT_PRESET_ZIP_JSON_MAX_BYTES: JSON_MAX_BYTES,
    PROMPT_PRESET_ZIP_MAX_JSON_FILES: MAX_JSON_FILES
  };
}));
