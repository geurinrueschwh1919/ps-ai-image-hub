(function definePromptPresetCompiler(root, factory) {
  "use strict";
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetCompiler(normalizer) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;

  function text(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function displayKey(value) { return String(value || "").replace(/^@param:/, "").replace(/_/g, " "); }

  function defaultValues(preset, supplied) {
    var values = Object.assign({}, supplied || {});
    [preset.controls, preset.fields, preset.toggles].forEach(function group(items) {
      (items || []).forEach(function assign(item) { if (values[item.id] === undefined) values[item.id] = item.default; });
    });
    return values;
  }

  function cleanPrompt(value) {
    return String(value || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/([，。！？；：,.!?;:])\1+/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripMarkerLines(value) {
    return String(value || "").split(/\r?\n/).filter(function keep(line) {
      return !/@param:|MODULE_START|MODULE_END/.test(line);
    }).map(function strip(line) { return line.replace(/^\s*\/\/\s?/, ""); }).join("\n");
  }

  function markerText(preset, values) {
    var lines = String(preset.sourceText || "").split(/\r?\n/);
    var removed = {};
    (preset.markerModules || []).forEach(function module(moduleInfo) {
      var disabled = (moduleInfo.paramIds || []).some(function zero(id) { return Number(values[id]) === 0 || values[id] === false; });
      if (disabled) for (var line = moduleInfo.startLine; line <= moduleInfo.endLine; line += 1) removed[line] = true;
    });
    return stripMarkerLines(lines.filter(function keep(line, index) { return !removed[index]; }).join("\n"));
  }

  function structuredLines(value, depth, key) {
    if (value === null || value === undefined || value === "") return [];
    if (key && (key.charAt(0) === "_" || key.indexOf("@param:") === 0 || ["id", "title", "category", "subCategory", "refImages", "metadata"].indexOf(key) !== -1)) return [];
    var indent = new Array(Math.min(depth, 4) + 1).join("  ");
    if (Array.isArray(value)) {
      var arrayText = value.map(function item(entry) { return typeof entry === "object" ? structuredLines(entry, depth + 1, "").join("；") : text(entry); }).filter(Boolean).join("；");
      return arrayText ? [indent + (key ? displayKey(key) + "：" : "") + arrayText] : [];
    }
    if (typeof value !== "object") return [indent + (key ? displayKey(key) + "：" : "") + text(value)];
    var output = [];
    if (key) output.push(indent + displayKey(key) + "：");
    Object.keys(value).forEach(function child(name) { output = output.concat(structuredLines(value[name], depth + (key ? 1 : 0), name)); });
    return output;
  }

  function replaceTemplate(template, values) {
    var output = String(template || "");
    Object.keys(values).forEach(function replace(id) {
      var value = values[id] === undefined || values[id] === null ? "" : String(values[id]);
      output = output.replace(new RegExp("\\{\\{\\s*" + escapeRegExp(id) + "\\s*\\}\\}", "g"), value);
      output = output.split("${" + id + "}").join(value);
    });
    return output;
  }

  function descriptorForValue(descriptor, value) {
    var source = [text(descriptor.range), text(descriptor.description)].filter(Boolean).join(";");
    if (descriptor.type !== "slider" || !source) return "";
    var candidates = [];
    source.split(/[;；]/).forEach(function part(value) {
      var range = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:-|~|至|到)\s*(-?\d+(?:\.\d+)?)\s*=\s*(.+)$/);
      if (range) { candidates.push({ min: Number(range[1]), max: Number(range[2]), text: text(range[3]) }); return; }
      var match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*=\s*(.+)$/);
      if (match) candidates.push({ at: Number(match[1]), text: text(match[2]) });
    });
    if (!candidates.length) return "";
    var numeric = Number(value);
    var matchingRange = candidates.find(function contains(item) { return item.min !== undefined && numeric >= item.min && numeric <= item.max; });
    if (matchingRange) return matchingRange.text;
    var points = candidates.filter(function point(item) { return item.at !== undefined; });
    if (!points.length) return "";
    points.sort(function sort(a, b) { return a.at - b.at; });
    var selected = points[0];
    points.forEach(function choose(item) { if (Math.abs(item.at - numeric) < Math.abs(selected.at - numeric)) selected = item; });
    return selected.text;
  }

  function strengthSemantic(descriptor, value) {
    var minimum = Number(descriptor.min), maximum = Number(descriptor.max), numeric = Number(value);
    if (!isFinite(minimum)) minimum = 0;
    if (!isFinite(maximum) || maximum <= minimum) maximum = 1;
    var normalized = Math.max(0, Math.min(1, (numeric - minimum) / (maximum - minimum)));
    if (normalized < 0.2) return "基本保持，极轻微调整";
    if (normalized < 0.4) return "轻微调整";
    if (normalized < 0.6) return "中等且明显的调整";
    if (normalized < 0.8) return "较强强化";
    return "高精度、最大程度强化";
  }

  function equivalentKey(value) {
    var source = normalizeComparable(value);
    var preserve = /保持|保留|不变|严禁改变|不要改变|preserve|keep|do not change|unchanged/;
    if (preserve.test(source) && /面部|五官|face|facial/.test(source)) return "preserve_face";
    if (preserve.test(source) && /构图|composition|layout/.test(source)) return "preserve_composition";
    if (preserve.test(source) && /发型|hairstyle/.test(source)) return "preserve_hairstyle";
    if (preserve.test(source) && /颜色|色彩|color|colour/.test(source)) return "preserve_color";
    if (/匹配|match/.test(source) && /光|lighting|light/.test(source)) return "light_match";
    if (/匹配|match/.test(source) && /噪点|颗粒|noise|grain/.test(source)) return "noise_match";
    if (/不变形|禁止变形|no transform|without transform/.test(source)) return "no_transform";
    return "";
  }

  function promptSegments(value) {
    var output = [];
    String(value || "").split(/\r?\n/).forEach(function line(textLine) {
      var matches = textLine.match(/[^。！？.!?]+[。！？.!?]?/g) || [];
      matches.forEach(function add(item) { var cleaned = text(item); if (cleaned) output.push(cleaned); });
    });
    return output;
  }

  function dedupePromptSemantics(value) {
    var selected = [], exact = {}, equivalentIndexes = {};
    promptSegments(value).forEach(function consider(segment) {
      var normalized = normalizeComparable(segment).replace(/[，。！？；：,.!?;:]+$/g, "");
      if (!normalized || exact[normalized]) return;
      var key = equivalentKey(segment);
      if (key && equivalentIndexes[key] !== undefined) {
        var index = equivalentIndexes[key];
        if (segment.length > selected[index].length) selected[index] = segment;
        exact[normalized] = true;
        return;
      }
      exact[normalized] = true;
      if (key) equivalentIndexes[key] = selected.length;
      selected.push(segment);
    });
    return cleanPrompt(selected.join("\n"));
  }

  function parameterLines(preset, values, template) {
    var output = [];
    [preset.controls, preset.fields, preset.toggles].forEach(function group(items) {
      (items || []).forEach(function add(item) {
        if (item.type === "hidden" || item.type === "note" || item.type === "section") return;
        var value = values[item.id];
        if (preset.sourceKind === "marker" && (Number(value) === 0 || value === false)) return;
        if (item.type === "toggle") {
          if (value === true) output.push(item.includeText || item.label);
          return;
        }
        if (value === undefined || value === null || text(value) === "") return;
        if (String(template || "").indexOf("{{" + item.id + "}}") !== -1 || String(template || "").indexOf("${" + item.id + "}") !== -1) return;
        var mapped = descriptorForValue(item, value);
        if (item.type === "slider" && !mapped) mapped = strengthSemantic(item, value);
        if (item.type === "select" && item.options) {
          var option = item.options.find(function find(candidate) { return String(candidate.value) === String(value); });
          mapped = option && option.text || mapped;
        }
        output.push(item.label + "：" + (mapped || value));
      });
    });
    return output;
  }

  function naturalTemplateValues(preset, values) {
    var output = Object.assign({}, values || {});
    [preset.controls, preset.fields, preset.toggles].forEach(function group(items) {
      (items || []).forEach(function map(item) {
        var value = output[item.id];
        if (item.type === "slider") output[item.id] = descriptorForValue(item, value) || strengthSemantic(item, value);
        else if (item.type === "select" && item.options) {
          var selected = item.options.find(function find(option) { return String(option.value) === String(value); });
          if (selected) output[item.id] = selected.text || selected.label || selected.value;
        }
      });
    });
    return output;
  }

  class PromptPresetCompiler {
    compile(preset, suppliedValues) {
      if (!preset || !preset.id) throw new PromptPresetError(CODES.NOT_FOUND, "Selected preset is unavailable.");
      try {
        var values = defaultValues(preset, suppliedValues);
        var base = preset.promptTemplate ? replaceTemplate(preset.promptTemplate, naturalTemplateValues(preset, values))
          : preset.sourceKind === "marker" ? markerText(preset, values)
            : preset.sourceKind === "structured" && preset.structuredContent ? structuredLines(preset.structuredContent, 0, "").join("\n")
              : stripMarkerLines(preset.sourceText || "");
        var parameters = parameterLines(preset, values, preset.promptTemplate);
        var coreRules = [].concat(preset.coreRules || [], preset.fixedRules || []).map(text).filter(Boolean);
        var output = dedupePromptSemantics([base, coreRules.length ? coreRules.join("\n") : "",
          parameters.length ? "参数设置：\n" + parameters.join("；") : ""].filter(Boolean).join("\n\n"));
        if (!output) throw new PromptPresetError(CODES.COMPILE_FAILED, "Preset compiled to empty text.");
        return output;
      } catch (error) {
        if (error && error.code) throw error;
        throw new PromptPresetError(CODES.COMPILE_FAILED, "Preset compilation failed.", { message: error && error.message });
      }
    }
  }

  function compilePresetStack(stack, registry, compiler) {
    var activeCompiler = compiler || new PromptPresetCompiler();
    var ids = [], titles = [], parts = [];
    (Array.isArray(stack) ? stack : []).slice().sort(function order(a, b) { return Number(a.order) - Number(b.order); })
      .forEach(function compile(item) {
        if (!item || item.enabled === false) return;
        var preset = registry && registry.get(item.presetId);
        if (!preset) return;
        parts.push(activeCompiler.compile(preset, item.values || {}));
        ids.push(preset.id); titles.push(preset.displayTitle || preset.title);
      });
    var output = dedupePromptSemantics(parts.join("\n\n"));
    if (!output) throw new PromptPresetError(CODES.COMPILE_FAILED, "No enabled preset could be compiled.");
    return { text: output, presetIds: ids, presetTitles: titles };
  }

  function normalizeComparable(value) { return cleanPrompt(value).replace(/\s+/g, " ").toLowerCase(); }
  function applyCompiledPrompt(current, compiled, mode) {
    var before = cleanPrompt(current), addition = cleanPrompt(compiled);
    if (!addition) throw new PromptPresetError(CODES.COMPILE_FAILED, "Preset compiled to empty text.");
    if (mode !== "append" || !before) return { text: addition, duplicate: false };
    var haystack = normalizeComparable(before), needle = normalizeComparable(addition);
    if (haystack === needle || haystack.indexOf(needle) !== -1) return { text: before, duplicate: true };
    return { text: cleanPrompt(before + "\n\n" + addition), duplicate: false };
  }

  return { PromptPresetCompiler: PromptPresetCompiler, applyCompiledPrompt: applyCompiledPrompt,
    cleanCompiledPrompt: cleanPrompt, promptPresetDescriptorForValue: descriptorForValue,
    promptPresetStructuredLines: structuredLines, mapPromptPresetStrength: strengthSemantic,
    promptPresetNaturalTemplateValues: naturalTemplateValues,
    dedupePromptPresetSemantics: dedupePromptSemantics, promptPresetEquivalentKey: equivalentKey,
    compilePromptPresetStack: compilePresetStack };
}));
