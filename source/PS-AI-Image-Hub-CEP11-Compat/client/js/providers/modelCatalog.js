(function defineModelCatalog(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createModelCatalog() {
  "use strict";

  function normalizeModel(model) {
    if (typeof model === "string") model = { id: model, displayName: model };
    var id = String(model && (model.id || model.modelId) || "").trim();
    if (!id) return null;
    return Object.assign({}, model, {
      id: id,
      modelId: String(model.modelId || id).trim(),
      displayName: String(model.displayName || id).trim() || id,
      family: model.family ? String(model.family).trim() : model.requestFamily ? String(model.requestFamily).trim() : null,
      requestFamily: model.requestFamily ? String(model.requestFamily).trim() : model.family ? String(model.family).trim() : null
    });
  }

  function normalizeModelList(models, fallbackModelId) {
    var list = Array.isArray(models) ? models.slice() : [];
    var result = list.reduce(function reduce(result, item) {
      var model = normalizeModel(item);
      if (!model) return result;
      var index = result.findIndex(function match(existing) { return existing.id === model.id; });
      if (index >= 0) result[index] = Object.assign({}, result[index], model);
      else result.push(model);
      return result;
    }, []);
    if (fallbackModelId && !result.some(function match(model) { return model.id === String(fallbackModelId); })) {
      result.push({ id: String(fallbackModelId), modelId: String(fallbackModelId), displayName: String(fallbackModelId), family: null, requestFamily: null });
    }
    return result;
  }

  return { normalizeModel: normalizeModel, normalizeModelList: normalizeModelList };
}));
