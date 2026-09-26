(function definePromptPresetNormalizer(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetNormalizer() {
  "use strict";

  function PromptPresetError(code, message, details) {
    this.name = "PromptPresetError";
    this.code = code;
    this.message = message;
    this.details = details || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, PromptPresetError);
  }
  PromptPresetError.prototype = Object.create(Error.prototype);
  PromptPresetError.prototype.constructor = PromptPresetError;

  var ERROR_CODES = Object.freeze({
    EMPTY: "PRESET_EMPTY",
    JSON_INVALID: "PRESET_JSON_INVALID",
    UNSUPPORTED: "PRESET_UNSUPPORTED",
    REQUIRED_FIELD: "PRESET_REQUIRED_FIELD",
    MARKER_INVALID: "PRESET_MARKER_INVALID",
    COMPILE_FAILED: "PRESET_COMPILE_FAILED",
    DUPLICATE: "PRESET_DUPLICATE",
    NOT_FOUND: "PRESET_NOT_FOUND",
    FILE_TOO_LARGE: "PRESET_FILE_TOO_LARGE",
    PACK_INVALID: "PRESET_PACK_INVALID",
    ZIP_INVALID: "PRESET_ZIP_INVALID",
    LIMIT_EXCEEDED: "PRESET_LIMIT_EXCEEDED",
    FACTORY_PROTECTED: "PRESET_FACTORY_PROTECTED"
  });

  var CATEGORY_ALIASES = Object.freeze({
    hair: "hair", hairstyle: "hair", "毛发": "hair", "头发": "hair",
    lighting: "lighting", light: "lighting", "灯光": "lighting", "光影": "lighting",
    face: "face", facial: "face", "面部": "face", "五官": "face",
    body: "body", figure: "body", "身材": "body", "体型": "body",
    clothes: "clothing", clothing: "clothing", outfit: "clothing", "服装": "clothing",
    pose: "pose", action: "pose", "动作": "pose", "姿势": "pose",
    background: "background", scene: "background", "背景": "background", "场景": "background",
    effect: "effect", effects: "effect", fx: "effect", "特效": "effect",
    composition: "composition", "构图": "composition",
    material: "texture", texture: "texture", "材质": "texture", "纹理": "texture",
    expression: "expression", "表情": "expression",
    merge: "merge", "溶图": "merge", "融合": "merge",
    general: "general", "通用": "general",
    other: "other", "其他": "other"
  });

  function text(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function fileTitle(value) { return text(value).replace(/^.*[\\/]/, "").replace(/\.json$/i, ""); }
  function hash(value) {
    var output = 2166136261;
    var source = String(value || "preset");
    for (var index = 0; index < source.length; index += 1) {
      output ^= source.charCodeAt(index);
      output = (output * 16777619) >>> 0;
    }
    return output.toString(36);
  }
  function safeId(value, title) {
    var source = text(value);
    if (source && /^[A-Za-z0-9._:-]{1,160}$/.test(source)) return source;
    return "local-preset-" + hash(source || title);
  }
  function normalizeCategory(value) {
    if (typeof value !== "string") return "other";
    var source = text(value);
    if (!source || source.length > 80 || /[\x00-\x1F\x7F]/.test(source) || /^(?:https?:|data:)/i.test(source) ||
        /^\d+$/.test(source) || /^[\s._\-/:\\]+$/.test(source) || /^\[object\s+object\]$/i.test(source)) return "other";
    return CATEGORY_ALIASES[source] || CATEGORY_ALIASES[source.toLowerCase()] || source;
  }
  function textList(value) {
    var items = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
    return items.map(text).filter(Boolean).slice(0, 100);
  }
  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function number(value, fallback) { var parsed = Number(value); return isFinite(parsed) ? parsed : fallback; }

  function rangeFromText(value) {
    var source = text(value);
    var explicit = source.match(/(-?\d+(?:\.\d+)?)\s*(?:-|~|至|到)\s*(-?\d+(?:\.\d+)?)/);
    if (explicit) return { min: Number(explicit[1]), max: Number(explicit[2]) };
    var matches = source.match(/-?\d+(?:\.\d+)?(?=\s*=)/g) || [];
    var values = matches.map(Number).filter(isFinite);
    return values.length ? { min: Math.min.apply(Math, values), max: Math.max.apply(Math, values) } : null;
  }

  function normalizeOptions(options) {
    return (Array.isArray(options) ? options : []).map(function option(item) {
      if (item && typeof item === "object") {
        var value = text(item.value !== undefined ? item.value : item.id);
        return { value: value, label: text(item.label || item.title || value), text: text(item.text || item.prompt || item.label || value) };
      }
      return { value: text(item), label: text(item), text: text(item) };
    }).filter(function valid(item) { return Boolean(item.value); });
  }

  function normalizeDescriptor(input, forcedType) {
    var source = input || {};
    var id = text(source.id || source.name || source.key);
    if (!id) return null;
    var type = text(forcedType || source.type || "text").toLowerCase();
    if (type === "checkbox") type = "toggle";
    if (["slider", "text", "textarea", "toggle", "select", "hidden", "note", "section"].indexOf(type) === -1) type = "text";
    var descriptor = {
      id: id,
      label: text(source.label || source.title || id),
      type: type,
      description: text(source.description || source.desc),
      range: text(source.range),
      placeholder: text(source.placeholder),
      default: source.default !== undefined ? source.default : source.value
    };
    if (type === "slider") {
      var parsedRange = rangeFromText(source.range || descriptor.description);
      descriptor.min = number(source.min, parsedRange ? parsedRange.min : 0);
      descriptor.max = number(source.max, parsedRange ? parsedRange.max : 1);
      if (descriptor.max < descriptor.min) { var swap = descriptor.min; descriptor.min = descriptor.max; descriptor.max = swap; }
      descriptor.step = number(source.step, descriptor.max - descriptor.min <= 2 ? 0.01 : 1);
      descriptor.default = Math.max(descriptor.min, Math.min(descriptor.max, number(descriptor.default, descriptor.min)));
    } else if (type === "toggle") descriptor.default = descriptor.default !== false;
    else if (type === "select") {
      descriptor.options = normalizeOptions(source.options || source.values || source.enum);
      descriptor.default = text(descriptor.default || descriptor.options[0] && descriptor.options[0].value);
    } else descriptor.default = descriptor.default === undefined || descriptor.default === null ? "" : descriptor.default;
    if (source.includeText !== undefined) descriptor.includeText = text(source.includeText);
    return descriptor;
  }

  function markerDescriptors(parameters) {
    return (parameters || []).map(function marker(parameter) {
      var value = parameter.value;
      var type = typeof value === "number" ? "slider" : typeof value === "boolean" ? "toggle" : "text";
      return normalizeDescriptor({ id: parameter.id, label: parameter.label || parameter.id, type: type,
        default: value, description: parameter.description, range: parameter.range });
    }).filter(Boolean);
  }

  function structuredDescriptors(payload) {
    var output = [];
    function visit(value, depth) {
      if (!value || typeof value !== "object" || depth > 10) return;
      if (Array.isArray(value)) { value.forEach(function child(item) { visit(item, depth + 1); }); return; }
      Object.keys(value).filter(function parameterKey(key) {
        return key.indexOf("@param:") === 0 && !/_(?:label|desc|range)$/.test(key);
      }).forEach(function descriptor(key) {
        var id = key.slice(7), current = value[key];
        var type = typeof current === "number" ? "slider" : typeof current === "boolean" ? "toggle" : "text";
        var normalized = normalizeDescriptor({ id: id, label: value["@param:" + id + "_label"] || id, type: type, default: current,
          description: value["@param:" + id + "_desc"], range: value["@param:" + id + "_range"] });
        if (normalized) output.push(normalized);
      });
      Object.keys(value).forEach(function nested(key) { if (key.indexOf("@param:") !== 0) visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return output;
  }

  function uniqueDescriptors(groups) {
    var seen = {};
    return groups.reduce(function flatten(output, group) {
      (group || []).forEach(function add(item) {
        var normalized = normalizeDescriptor(item);
        if (normalized && !seen[normalized.id]) { seen[normalized.id] = true; output.push(normalized); }
      });
      return output;
    }, []);
  }

  function normalizePromptPreset(raw, context) {
    var source = raw && typeof raw === "object" ? raw : {};
    var settings = context || {};
    var payload = settings.payload && typeof settings.payload === "object" ? settings.payload : source;
    var title = text(source.title || source.name || payload.title || payload.name || fileTitle(settings.fileName));
    if (!title) throw new PromptPresetError(ERROR_CODES.REQUIRED_FIELD, "Preset title is required.", { field: "title" });
    var standardControls = uniqueDescriptors([source.controls, payload.controls]);
    var fields = uniqueDescriptors([(source.fields || []).map(function field(item) { return Object.assign({}, item, { type: item.type || "text" }); }),
      (payload.fields || []).map(function field(item) { return Object.assign({}, item, { type: item.type || "text" }); })]);
    var toggles = uniqueDescriptors([(source.toggles || []).map(function toggle(item) { return Object.assign({}, item, { type: "toggle" }); }),
      (payload.toggles || []).map(function toggle(item) { return Object.assign({}, item, { type: "toggle" }); })]);
    var extracted = settings.markerParameters && settings.markerParameters.length ? markerDescriptors(settings.markerParameters) : structuredDescriptors(payload);
    var controls = uniqueDescriptors([standardControls, extracted]);
    var promptTemplate = text(source.promptTemplate || payload.promptTemplate);
    var sourceText = text(settings.sourceText || (typeof source.content === "string" ? source.content : ""));
    var structuredContent = settings.structuredContent || (payload !== source ? payload : null);
    if (!promptTemplate && !sourceText && !structuredContent && !controls.length && !fields.length && !toggles.length) {
      throw new PromptPresetError(ERROR_CODES.UNSUPPORTED, "Preset does not contain a supported prompt structure.");
    }
    var categoryValue = typeof source.category === "string" && text(source.category) ? source.category : payload.category;
    var originalCategory = typeof categoryValue === "string" ? text(categoryValue) : "";
    var recommendedApplyMode = source.recommendedApplyMode || payload.recommendedApplyMode || source.applyModeDefault || payload.applyModeDefault;
    return {
      id: safeId(source.id || payload.id, title),
      title: title,
      category: normalizeCategory(categoryValue),
      subCategory: text(source.subCategory || payload.subCategory),
      description: text(source.description || payload.description),
      version: text(source.version || payload.version || "1"),
      recommendedMode: text(source.recommendedMode || payload.recommendedMode || "any"),
      requiresMainImage: source.requiresMainImage === true || payload.requiresMainImage === true,
      supportsReferenceImages: source.supportsReferenceImages !== false && payload.supportsReferenceImages !== false,
      recommendedApplyMode: recommendedApplyMode === "append" ? "append" : "replace",
      applyModeDefault: recommendedApplyMode === "append" ? "append" : "replace",
      recommendedReferenceCount: isFinite(Number(source.recommendedReferenceCount !== undefined ? source.recommendedReferenceCount : payload.recommendedReferenceCount))
        ? Math.max(0, Math.floor(Number(source.recommendedReferenceCount !== undefined ? source.recommendedReferenceCount : payload.recommendedReferenceCount))) : null,
      usageHint: text(source.usageHint || payload.usageHint),
      coreRules: textList(source.coreRules || payload.coreRules),
      fixedRules: textList(source.fixedRules || payload.fixedRules),
      factory: settings.trustedFactory === true && (source.factory === true || payload.factory === true),
      controls: controls,
      fields: fields,
      toggles: toggles,
      promptTemplate: promptTemplate,
      negativePromptTemplate: text(source.negativePromptTemplate || payload.negativePromptTemplate),
      sourceKind: settings.sourceKind || (promptTemplate ? "template" : structuredContent ? "structured" : "text"),
      sourceText: sourceText,
      structuredContent: copy(structuredContent),
      markerModules: copy(settings.markerModules || []),
      refImages: copy(source.refImages || payload.refImages || []),
      metadata: Object.assign({}, copy(source.metadata || payload.metadata || {}), {
        importedFileName: fileTitle(settings.fileName),
        originalCategory: originalCategory
      })
    };
  }

  return { PromptPresetError: PromptPresetError, PROMPT_PRESET_ERROR_CODES: ERROR_CODES,
    normalizePromptPreset: normalizePromptPreset, normalizePromptPresetDescriptor: normalizeDescriptor,
    promptPresetRangeFromText: rangeFromText, promptPresetSafeId: safeId,
    normalizePromptPresetCategory: normalizeCategory, PROMPT_PRESET_CATEGORY_ALIASES: CATEGORY_ALIASES };
}));
