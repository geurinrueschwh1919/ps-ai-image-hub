(function definePromptPresetRegistry(root, factory) {
  "use strict";
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetRegistry(normalizer) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;
  var FAVORITES_CATEGORY_KEY = "**favorites**";
  function copy(value) { return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)); }
  function presetType(preset) {
    if (preset && preset.sourceKind === "marker") return "marker";
    return [].concat(preset && preset.controls || [], preset && preset.fields || [], preset && preset.toggles || []).some(function visible(item) {
      return item && item.type !== "hidden" && item.type !== "note" && item.type !== "section";
    }) ? "adjustable" : "static";
  }
  function copyId(base, presets) {
    var rootId = String(base || "local-preset") + "-copy", id = rootId, sequence = 2;
    while (presets.some(function exists(item) { return item.id === id; })) { id = rootId + "-" + sequence; sequence += 1; }
    return id;
  }
  function copyDisplayName(title, presets, store) {
    var base = String(title || "预设"), used = {};
    presets.forEach(function collect(item) {
      used[String(store && store.getDisplayName ? store.getDisplayName(item.id) : "") || String(item.title || "")] = true;
    });
    var sequence = 1, candidate = base + " 副本 " + sequence;
    while (used[candidate]) { sequence += 1; candidate = base + " 副本 " + sequence; }
    return candidate;
  }
  function searchText(preset) {
    var item = preset || {};
    function flat(value) {
      if (Array.isArray(value)) return value.filter(function present(entry) { return typeof entry === "string" || typeof entry === "number"; }).join(" ");
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    }
    return [item.title, item.category, item.subCategory, item.description, flat(item.tags), item.promptTemplate,
      flat(item.coreRules), flat(item.fixedRules), typeof item.content === "string" ? item.content : ""]
      .map(flat).join(" ").trim().toLowerCase();
  }

  class PromptPresetRegistry {
    constructor(options) {
      this.store = options && options.store || null;
      this.presets = [];
      this.searchIndex = {};
      this.lastDeletePersistent = true;
      this.reload();
    }
    rebuildSearchIndex() {
      var index = {};
      this.presets.forEach(function add(item) { index[item.id] = searchText(item); });
      this.searchIndex = index;
    }
    reload() { this.presets = this.store && typeof this.store.load === "function" ? this.store.load() : []; this.rebuildSearchIndex(); return this.list(); }
    persist() { if (this.store && typeof this.store.save === "function") this.store.save(this.presets); this.rebuildSearchIndex(); }
    stateSnapshot() { return this.store && typeof this.store.loadState === "function" ? this.store.loadState() : null; }
    decorate(preset, state) {
      if (!preset) return null;
      var result = copy(preset);
      result.localDisplayName = state ? String(state.displayNames && state.displayNames[result.id] || "")
        : this.store && this.store.getDisplayName ? this.store.getDisplayName(result.id) : "";
      result.displayTitle = result.localDisplayName || result.title;
      result.favorite = state ? state.favorites.indexOf(result.id) !== -1
        : Boolean(this.store && this.store.isFavorite && this.store.isFavorite(result.id));
      result.presetType = presetType(result);
      return result;
    }
    list(options) {
      var settings = options || {}, query = String(settings.search || "").trim().toLowerCase(), category = String(settings.category || "all");
      var state = this.stateSnapshot(), hidden = state && state.hiddenFactoryPresetIds || [];
      return this.presets.filter((item) => {
        if (item.factory && (state ? hidden.indexOf(item.id) !== -1 : this.store && this.store.isFactoryHidden && this.store.isFactoryHidden(item.id))) return false;
        if (category === FAVORITES_CATEGORY_KEY) {
          if (!(state ? state.favorites.indexOf(item.id) !== -1 : this.store && this.store.isFavorite && this.store.isFavorite(item.id))) return false;
        } else if (category !== "all" && item.category !== category) return false;
        if (!query) return true;
        var localName = state ? state.displayNames && state.displayNames[item.id] || ""
          : this.store && this.store.getDisplayName ? this.store.getDisplayName(item.id) : "";
        return ((this.searchIndex[item.id] || "") + " " + String(localName).toLowerCase()).indexOf(query) !== -1;
      }).map((item) => this.decorate(item, state));
    }
    categories() {
      var seen = {};
      return this.list().map(function category(item) { return item.category || "other"; }).filter(function unique(value) {
        if (seen[value]) return false; seen[value] = true; return true;
      }).sort();
    }
    get(id) {
      var preset = this.presets.find(function match(item) { return item.id === String(id || ""); });
      return this.decorate(preset || null, this.stateSnapshot());
    }
    register(preset, options) {
      var settings = options || {};
      if (!preset || !preset.id || !preset.title) throw new PromptPresetError(CODES.REQUIRED_FIELD, "Preset ID and title are required.");
      if (this.presets.length >= 500) throw new PromptPresetError(CODES.LIMIT_EXCEEDED, "Preset library limit exceeded.");
      var duplicateId = this.presets.find(function match(item) { return item.id === preset.id; });
      var duplicateTitle = this.presets.find(function match(item) { return item.title === preset.title; });
      if ((duplicateId || duplicateTitle) && settings.conflict === "copy") {
        var copied = copy(preset);
        copied.id = copyId(copied.id, this.presets);
        var displayName = copyDisplayName(copied.title, this.presets, this.store);
        this.presets.push(copied); this.persist();
        if (this.store && this.store.setDisplayName) this.store.setDisplayName(copied.id, displayName);
        return this.get(copied.id);
      }
      if (duplicateId && settings.conflict === "overwrite") {
        var index = this.presets.indexOf(duplicateId);
        this.presets.splice(index, 1, copy(preset)); this.persist(); return this.get(preset.id);
      }
      if (duplicateId || duplicateTitle) {
        if (settings.conflict === "skip") return null;
        var duplicate = duplicateId || duplicateTitle;
        throw new PromptPresetError(CODES.DUPLICATE, "A preset with the same ID or title already exists.", { id: duplicate.id, title: duplicate.title });
      }
      this.presets.push(copy(preset)); this.persist(); return this.get(preset.id);
    }
    registerMany(presets, options) {
      var added = [], skipped = [];
      (presets || []).forEach((preset) => {
        try { var item = this.register(preset, options); if (item) added.push(item); else skipped.push(preset.id); }
        catch (error) { if (options && options.conflict === "skip" && error.code === CODES.DUPLICATE) skipped.push(preset.id); else throw error; }
      });
      return { added: added, skipped: skipped };
    }
    remove(id) {
      var preset = this.presets.find(function match(item) { return item.id === String(id || ""); });
      if (!preset) throw new PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
      if (preset.factory) {
        if (this.store && this.store.setFactoryHidden) this.store.setFactoryHidden(preset.id, true);
        this.lastDeletePersistent = !(this.store && this.store.isPersistent) || this.store.isPersistent();
        return true;
      }
      if (this.store && typeof this.store.deletePreset === "function") {
        var result = this.store.deletePreset(preset.id);
        this.presets = result.state.presets.slice();
        this.lastDeletePersistent = result.persistent !== false;
        this.rebuildSearchIndex();
        return true;
      }
      var nextPresets = this.presets.filter(function keep(item) { return item.id !== preset.id; });
      if (this.store && typeof this.store.save === "function") this.store.save(nextPresets);
      this.presets = nextPresets;
      this.rebuildSearchIndex();
      if (this.store && this.store.removePresetData) this.store.removePresetData(preset.id);
      else if (this.store && this.store.getRecentId && this.store.getRecentId() === preset.id) this.store.setRecentId("");
      return true;
    }
    wasLastDeletePersistent() { return this.lastDeletePersistent; }
    restoreFactory(id) {
      var preset = this.presets.find(function match(item) { return item.id === String(id || "") && item.factory; });
      if (!preset) throw new PromptPresetError(CODES.NOT_FOUND, "Factory preset is unavailable.");
      if (this.store && this.store.setFactoryHidden) this.store.setFactoryHidden(preset.id, false);
      return this.get(preset.id);
    }
    restoreAllFactories() {
      var hidden = this.store && this.store.getHiddenFactoryPresetIds ? this.store.getHiddenFactoryPresetIds() : [];
      hidden.forEach((id) => { if (this.presets.some(function match(item) { return item.id === id && item.factory; })) this.store.setFactoryHidden(id, false); });
      return this.list();
    }
    rename(id, displayName) {
      if (!this.get(id)) throw new PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
      if (this.store && this.store.setDisplayName) this.store.setDisplayName(id, displayName);
      return this.get(id);
    }
    resetDisplayName(id) { return this.rename(id, ""); }
    toggleFavorite(id) {
      if (!this.get(id)) throw new PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
      var favorite = !(this.store && this.store.isFavorite && this.store.isFavorite(id));
      if (this.store && this.store.setFavorite) this.store.setFavorite(id, favorite);
      return favorite;
    }
    favorites() { return this.list().filter(function favorite(item) { return item.favorite; }); }
    recent(limit) {
      var ids = this.store && this.store.getRecentIds ? this.store.getRecentIds(limit || 10) : [];
      return ids.map((id) => this.get(id)).filter(Boolean);
    }
    recordApplied(ids) {
      var values = Array.isArray(ids) ? ids : [ids];
      values.slice().reverse().forEach((id) => { if (this.get(id) && this.store && this.store.recordApplied) this.store.recordApplied(id); });
    }
    getRecentId() { return this.store && this.store.getRecentId ? this.store.getRecentId() : ""; }
    setRecentId(id) { if (this.store && this.store.setRecentId) this.store.setRecentId(id); }
  }

  return { PromptPresetRegistry: PromptPresetRegistry, getPromptPresetType: presetType,
    buildPromptPresetSearchText: searchText, PROMPT_PRESET_FAVORITES_CATEGORY_KEY: FAVORITES_CATEGORY_KEY };
}));
