(function definePromptPresetParser(root, factory) {
  "use strict";
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetParser(normalizer) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;

  function cleanQuoted(value) {
    var output = String(value === undefined || value === null ? "" : value).trim().replace(/,$/, "").trim();
    if ((output.charAt(0) === '"' && output.charAt(output.length - 1) === '"') ||
        (output.charAt(0) === "'" && output.charAt(output.length - 1) === "'")) {
      try { return JSON.parse(output.charAt(0) === '"' ? output : '"' + output.slice(1, -1).replace(/"/g, '\\"') + '"'); }
      catch (error) { return output.slice(1, -1); }
    }
    if (/^(?:true|false)$/i.test(output)) return output.toLowerCase() === "true";
    if (/^-?\d+(?:\.\d+)?$/.test(output)) return Number(output);
    return output;
  }

  function parseMarkerText(source) {
    var text = String(source || "");
    var lines = text.split(/\r?\n/);
    var values = {}, labels = {}, descriptions = {}, ranges = {};
    var modules = [], open = null;
    lines.forEach(function inspect(line, index) {
      var start = line.match(/MODULE_START\s*:\s*([A-Za-z0-9_.:-]+)/i);
      if (start) {
        if (open) throw new PromptPresetError(CODES.MARKER_INVALID, "Nested MODULE_START markers are not supported.", { line: index + 1 });
        open = { id: start[1], startLine: index, endLine: null, paramIds: [] };
      }
      var end = line.match(/MODULE_END\s*:\s*([A-Za-z0-9_.:-]+)/i);
      if (end) {
        if (!open || open.id !== end[1]) throw new PromptPresetError(CODES.MARKER_INVALID, "MODULE_END does not match MODULE_START.", { line: index + 1 });
        open.endLine = index; modules.push(open); open = null;
      }
      var parameter = line.match(/@param:([^"\s:]+?)(?:_(label|desc|range))?"?\s*:\s*(.+?)\s*$/i);
      if (!parameter) return;
      var id = parameter[1], kind = String(parameter[2] || "").toLowerCase(), value = cleanQuoted(parameter[3]);
      if (kind === "label") labels[id] = value;
      else if (kind === "desc") descriptions[id] = value;
      else if (kind === "range") ranges[id] = value;
      else { values[id] = value; if (open && open.paramIds.indexOf(id) === -1) open.paramIds.push(id); }
    });
    if (open) throw new PromptPresetError(CODES.MARKER_INVALID, "MODULE_START is missing a matching MODULE_END.", { moduleId: open.id });
    var parameters = Object.keys(values).map(function parameter(id) {
      return { id: id, value: values[id], label: labels[id] || id, description: descriptions[id] || "", range: ranges[id] || "" };
    });
    return { parameters: parameters, modules: modules, hasMarkers: parameters.length > 0 || modules.length > 0 };
  }

  function unwrap(value) {
    if (!Array.isArray(value)) return value;
    for (var index = 0; index < value.length; index += 1) {
      if (value[index] && (typeof value[index] === "object" || typeof value[index] === "string")) return value[index];
    }
    return null;
  }

  function parseJson(value, code) {
    try { return JSON.parse(value); }
    catch (error) { throw new PromptPresetError(code || CODES.JSON_INVALID, "Preset JSON could not be parsed.", { message: error && error.message }); }
  }

  function parsePromptPreset(input, options) {
    var settings = options || {};
    var rawText = typeof input === "string" ? input.replace(/^\uFEFF/, "").trim() : "";
    if (typeof input === "string" && !rawText) throw new PromptPresetError(CODES.EMPTY, "Preset file is empty.");
    var parsed;
    if (typeof input === "string") {
      try { parsed = JSON.parse(rawText); }
      catch (error) {
        if (/@param:|MODULE_START|MODULE_END/.test(rawText)) parsed = { title: settings.fileName, content: rawText };
        else throw new PromptPresetError(CODES.JSON_INVALID, "Preset JSON could not be parsed.", { message: error && error.message });
      }
    } else parsed = input;
    parsed = unwrap(parsed);
    if (!parsed || (typeof parsed !== "object" && typeof parsed !== "string")) throw new PromptPresetError(CODES.UNSUPPORTED, "Preset root must be an object or a non-empty array of objects.");
    if (typeof parsed === "string") parsed = { title: settings.fileName, content: parsed };

    var payload = parsed;
    var sourceText = "";
    var structured = null;
    var sourceKind = parsed.promptTemplate ? "template" : "structured";
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      sourceText = parsed.content.trim(); sourceKind = "text";
      var trimmed = sourceText.replace(/^\uFEFF/, "").trim();
      if (/^[\[{]/.test(trimmed)) {
        try {
          var nested = unwrap(JSON.parse(trimmed));
          if (nested && typeof nested === "object") { payload = nested; structured = nested; sourceKind = "structured"; }
        } catch (error) { /* A marker or long static text remains a text preset. */ }
      }
    } else if (parsed.content && typeof parsed.content === "object") {
      payload = unwrap(parsed.content) || parsed; structured = payload; sourceKind = "structured";
    } else if (!parsed.promptTemplate) structured = parsed;

    var marker = sourceKind === "text" && sourceText ? parseMarkerText(sourceText) : { parameters: [], modules: [], hasMarkers: false };
    if (marker.hasMarkers) sourceKind = "marker";
    return normalizer.normalizePromptPreset(parsed, {
      fileName: settings.fileName,
      payload: payload,
      sourceText: sourceText,
      structuredContent: structured,
      sourceKind: sourceKind,
      markerParameters: marker.parameters,
      markerModules: marker.modules,
      trustedFactory: settings.trustedFactory === true
    });
  }

  class PromptPresetParser {
    parse(input, options) { return parsePromptPreset(input, options); }
  }

  return { PromptPresetParser: PromptPresetParser, parsePromptPreset: parsePromptPreset,
    parsePromptPresetMarkers: parseMarkerText, unwrapPromptPresetRoot: unwrap, parsePromptPresetJson: parseJson };
}));
