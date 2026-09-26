(function defineAspectRatioResolver(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAspectRatioResolver() {
  "use strict";

  function ratioValue(value) {
    var match = String(value || "").match(/^\s*(\d+(?:\.\d+)?)\s*[:xX]\s*(\d+(?:\.\d+)?)\s*$/);
    if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return null;
    return Number(match[1]) / Number(match[2]);
  }

  function resolveAspectRatio(width, height, supportedRatios) {
    var target = Number(width) / Number(height);
    if (!isFinite(target) || target <= 0) return null;
    var candidates = (supportedRatios || []).map(function candidate(value) {
      return { value: value, ratio: ratioValue(value) };
    }).filter(function valid(item) { return item.ratio !== null; });
    if (!candidates.length) return null;
    candidates.sort(function nearest(a, b) {
      return Math.abs(Math.log(a.ratio / target)) - Math.abs(Math.log(b.ratio / target));
    });
    return candidates[0].value;
  }

  return { resolveAspectRatio: resolveAspectRatio, parseAspectRatioValue: ratioValue };
}));
