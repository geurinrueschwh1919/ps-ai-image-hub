(function definePromptPresetStack(root, factory) {
  "use strict";
  var normalizer = typeof module === "object" && module.exports ? require("./promptPresetNormalizer") : root.PSAIImageHubCompat;
  var api = factory(normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetStack(normalizer) {
  "use strict";
  var PromptPresetError = normalizer.PromptPresetError;
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;
  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  class PromptPresetStack {
    constructor(options) {
      var settings = options || {};
      this.registry = settings.registry;
      this.store = settings.store || this.registry && this.registry.store || null;
      this.items = this.store && this.store.getStack ? this.store.getStack() : [];
      this.normalize();
    }
    normalize() {
      var seen = {};
      this.items = (this.items || []).filter((item) => {
        var id = String(item && item.presetId || "");
        if (!id || seen[id] || !this.registry || !this.registry.get(id)) return false;
        seen[id] = true; return true;
      }).map(function item(value, index) {
        return { presetId: String(value.presetId), enabled: value.enabled !== false, order: index,
          values: value.values && typeof value.values === "object" ? copy(value.values) : {} };
      });
      return this.items;
    }
    persist() { this.normalize(); if (this.store && this.store.setStack) this.store.setStack(this.items); return this.list(); }
    list() { return this.items.map(copy); }
    get(id) { var item = this.items.find(function match(value) { return value.presetId === String(id || ""); }); return copy(item || null); }
    add(id) {
      var value = String(id || "");
      if (!this.registry || !this.registry.get(value)) throw new PromptPresetError(CODES.NOT_FOUND, "Preset is not in the library.");
      if (this.get(value)) return this.get(value);
      var lastValues = this.store && this.store.getLastValues ? this.store.getLastValues(value) : {};
      this.items.push({ presetId: value, enabled: true, order: this.items.length, values: lastValues || {} });
      this.persist(); return this.get(value);
    }
    remove(id) {
      var before = this.items.length, value = String(id || "");
      this.items = this.items.filter(function keep(item) { return item.presetId !== value; });
      if (before === this.items.length) return false;
      this.persist(); return true;
    }
    move(id, direction) {
      var value = String(id || ""), index = this.items.findIndex(function match(item) { return item.presetId === value; });
      var target = index + Number(direction || 0);
      if (index < 0 || target < 0 || target >= this.items.length) return false;
      var item = this.items.splice(index, 1)[0]; this.items.splice(target, 0, item); this.persist(); return true;
    }
    setEnabled(id, enabled) {
      var item = this.items.find(function match(value) { return value.presetId === String(id || ""); });
      if (!item) return false; item.enabled = enabled !== false; this.persist(); return true;
    }
    setValues(id, values) {
      var item = this.items.find(function match(value) { return value.presetId === String(id || ""); });
      if (!item) throw new PromptPresetError(CODES.NOT_FOUND, "Preset is not in the current stack.");
      item.values = copy(values && typeof values === "object" ? values : {});
      if (this.store && this.store.setLastValues) this.store.setLastValues(item.presetId, item.values);
      this.persist(); return copy(item.values);
    }
    enabledItems() { return this.list().filter(function enabled(item) { return item.enabled; }); }
    metadata() {
      var ids = [], titles = [];
      this.enabledItems().forEach((item) => {
        var preset = this.registry && this.registry.get(item.presetId);
        if (preset) { ids.push(preset.id); titles.push(preset.displayTitle || preset.title); }
      });
      return { presetIds: ids, presetTitles: titles };
    }
  }

  return { PromptPresetStack: PromptPresetStack };
}));
