(function definePromptPresetStore(root, factory) {
  "use strict";
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(root, normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetStore(root, normalizer) {
  "use strict";
  var LEGACY_STORAGE_KEY = "ps-ai-image-hub.compat.cep11.prompt-presets.v1";
  var LEGACY_RECENT_KEY = "ps-ai-image-hub.compat.cep11.prompt-presets.recent.v1";
  var STORAGE_KEY = "ps-ai-image-hub.compat.cep11.prompt-presets.v2";
  var STORE_VERSION = 2;
  var MAX_PRESETS = 500;
  var MAX_RECENT = 10;

  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function emptyState() {
    return { version: STORE_VERSION, presets: [], favorites: [], recent: [], displayNames: {}, lastValues: {}, stack: [], hiddenFactoryPresetIds: [] };
  }
  function strings(value, maximum) {
    var seen = {};
    return (Array.isArray(value) ? value : []).map(function item(entry) {
      return String(entry && typeof entry === "object" ? entry.id : entry || "");
    }).filter(function unique(id) {
      if (!id || seen[id]) return false; seen[id] = true; return true;
    }).slice(0, maximum);
  }
  function sanitizeRecent(value) {
    var output = [], seen = {};
    (Array.isArray(value) ? value : []).forEach(function add(item) {
      var id = String(item && typeof item === "object" ? item.id : item || "");
      if (!id || seen[id]) return;
      seen[id] = true;
      output.push({ id: id, appliedAt: String(item && item.appliedAt || "") });
    });
    return output.slice(0, MAX_RECENT);
  }
  function restoreStoredCategory(value) {
    var preset = copy(value);
    if (!preset || preset.factory || preset.category !== "other" || !preset.metadata || typeof preset.metadata.originalCategory !== "string") return preset;
    var original = preset.metadata.originalCategory.trim();
    var recovered = normalizer && typeof normalizer.normalizePromptPresetCategory === "function"
      ? normalizer.normalizePromptPresetCategory(original) : "other";
    if (original && recovered !== "other") preset.category = recovered;
    return preset;
  }
  function sanitizeState(input) {
    var source = input && typeof input === "object" ? input : {};
    var state = emptyState();
    state.presets = (Array.isArray(source.presets) ? source.presets : []).filter(function valid(item) {
      return item && item.id && item.title;
    }).slice(0, MAX_PRESETS).map(restoreStoredCategory);
    state.favorites = strings(source.favorites, MAX_PRESETS);
    state.recent = sanitizeRecent(source.recent);
    state.displayNames = source.displayNames && typeof source.displayNames === "object" ? copy(source.displayNames) : {};
    state.lastValues = source.lastValues && typeof source.lastValues === "object" ? copy(source.lastValues) : {};
    state.stack = (Array.isArray(source.stack) ? source.stack : []).filter(function valid(item) { return item && item.presetId; })
      .slice(0, MAX_PRESETS).map(function stackItem(item, index) {
        return { presetId: String(item.presetId), enabled: item.enabled !== false, order: index,
          values: item.values && typeof item.values === "object" ? copy(item.values) : {} };
      });
    state.hiddenFactoryPresetIds = strings(source.hiddenFactoryPresetIds, MAX_PRESETS);
    return state;
  }

  class PromptPresetStore {
    constructor(options) {
      this.storage = options && options.storage || root.localStorage;
      this.state = null;
      this.migrationFailed = false;
    }
    migrateLegacy() {
      var state = emptyState();
      if (!this.storage) return state;
      try {
        var legacy = JSON.parse(this.storage.getItem(LEGACY_STORAGE_KEY) || "[]");
        state.presets = Array.isArray(legacy) ? legacy : [];
      } catch (error) { this.migrationFailed = true; }
      try {
        var recentId = this.storage.getItem(LEGACY_RECENT_KEY);
        if (recentId) state.recent = [{ id: String(recentId), appliedAt: "" }];
      } catch (error) { this.migrationFailed = true; }
      return sanitizeState(state);
    }
    loadState() {
      if (this.state) return copy(this.state);
      var state = null, needsRewrite = false;
      if (this.storage) {
        try {
          var raw = this.storage.getItem(STORAGE_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            state = sanitizeState(parsed);
            needsRewrite = JSON.stringify(parsed) !== JSON.stringify(state);
          }
        } catch (error) { this.migrationFailed = true; }
      }
      if (!state) {
        state = this.migrateLegacy();
        try { this.writeState(state); } catch (error) { this.migrationFailed = true; }
      }
      this.state = state;
      if (needsRewrite) {
        try { this.writeState(state); } catch (error) { this.migrationFailed = true; }
      }
      return copy(state);
    }
    writeState(value) {
      var state = sanitizeState(value);
      this.state = state;
      if (this.storage) {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
        // Keep the Phase 10P keys readable for rollback builds; V2 remains authoritative.
        this.storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state.presets));
        if (state.recent[0] && state.recent[0].id) this.storage.setItem(LEGACY_RECENT_KEY, state.recent[0].id);
        else this.storage.removeItem(LEGACY_RECENT_KEY);
      }
      return copy(state);
    }
    update(mutator) {
      var state = this.loadState();
      mutator(state);
      return this.writeState(state);
    }
    load() { return this.loadState().presets; }
    save(presets) { return this.update(function replace(state) { state.presets = Array.isArray(presets) ? presets : []; }).presets; }
    isFavorite(id) { return this.loadState().favorites.indexOf(String(id || "")) !== -1; }
    setFavorite(id, favorite) {
      var value = String(id || "");
      return this.update(function change(state) {
        state.favorites = state.favorites.filter(function keep(item) { return item !== value; });
        if (favorite && value) state.favorites.unshift(value);
      }).favorites;
    }
    getRecentIds(limit) { return this.loadState().recent.slice(0, limit || MAX_RECENT).map(function id(item) { return item.id; }); }
    getRecentId() { return this.getRecentIds(1)[0] || ""; }
    setRecentId(id) { if (id) this.recordApplied(id); else this.update(function clear(state) { state.recent = []; }); }
    recordApplied(id, at) {
      var value = String(id || "");
      if (!value) return [];
      return this.update(function add(state) {
        state.recent = state.recent.filter(function keep(item) { return item.id !== value; });
        state.recent.unshift({ id: value, appliedAt: String(at || new Date().toISOString()) });
      }).recent;
    }
    getDisplayName(id) { return String(this.loadState().displayNames[String(id || "")] || ""); }
    setDisplayName(id, name) {
      var value = String(id || ""), title = String(name || "").trim();
      return this.update(function change(state) { if (title) state.displayNames[value] = title; else delete state.displayNames[value]; }).displayNames[value] || "";
    }
    getLastValues(id) { return copy(this.loadState().lastValues[String(id || "")] || {}); }
    setLastValues(id, values) {
      var value = String(id || "");
      this.update(function change(state) { state.lastValues[value] = copy(values && typeof values === "object" ? values : {}); });
    }
    getStack() { return copy(this.loadState().stack); }
    setStack(stack) { return this.update(function change(state) { state.stack = Array.isArray(stack) ? stack : []; }).stack; }
    setFactoryHidden(id, hidden) {
      var value = String(id || "");
      return this.update(function change(state) {
        state.hiddenFactoryPresetIds = state.hiddenFactoryPresetIds.filter(function keep(item) { return item !== value; });
        if (hidden && value) state.hiddenFactoryPresetIds.push(value);
      }).hiddenFactoryPresetIds;
    }
    isFactoryHidden(id) { return this.loadState().hiddenFactoryPresetIds.indexOf(String(id || "")) !== -1; }
    getHiddenFactoryPresetIds() { return this.loadState().hiddenFactoryPresetIds.slice(); }
    removePresetData(id) {
      var value = String(id || "");
      return this.update(function remove(state) {
        state.favorites = state.favorites.filter(function keep(item) { return item !== value; });
        state.recent = state.recent.filter(function keep(item) { return item.id !== value; });
        state.stack = state.stack.filter(function keep(item) { return item.presetId !== value; });
        delete state.displayNames[value]; delete state.lastValues[value];
      });
    }
  }

  return {
    PromptPresetStore: PromptPresetStore,
    PROMPT_PRESET_STORAGE_KEY: LEGACY_STORAGE_KEY,
    PROMPT_PRESET_V2_STORAGE_KEY: STORAGE_KEY,
    PROMPT_PRESET_RECENT_KEY: LEGACY_RECENT_KEY,
    PROMPT_PRESET_STORE_VERSION: STORE_VERSION,
    MAX_LOCAL_PROMPT_PRESETS: MAX_PRESETS,
    MAX_RECENT_PROMPT_PRESETS: MAX_RECENT,
    createEmptyPromptPresetState: emptyState,
    restoreStoredPromptPresetCategory: restoreStoredCategory
  };
}));
