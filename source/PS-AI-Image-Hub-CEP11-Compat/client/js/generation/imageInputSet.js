(function defineImageInputSet(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImageInputSetModule() {
  "use strict";
  var MAX_REFERENCE_IMAGES = 8;

  function createImageInputSet(input) {
    var source = input || {};
    var references = Array.isArray(source.referenceImages) ? source.referenceImages.slice(0, MAX_REFERENCE_IMAGES) : [];
    return { mainImage: source.mainImage || null, referenceImages: references };
  }

  function orderedImageInputs(inputSet) {
    var set = createImageInputSet(inputSet);
    return (set.mainImage ? [set.mainImage] : []).concat(set.referenceImages);
  }

  function moveReference(referenceImages, fromIndex, toIndex) {
    var list = Array.isArray(referenceImages) ? referenceImages.slice() : [];
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length || fromIndex === toIndex) return list;
    var item = list.splice(fromIndex, 1)[0];
    list.splice(toIndex, 0, item);
    return list;
  }

  return {
    MAX_REFERENCE_IMAGES: MAX_REFERENCE_IMAGES,
    createImageInputSet: createImageInputSet,
    orderedImageInputs: orderedImageInputs,
    moveReferenceImage: moveReference
  };
}));
