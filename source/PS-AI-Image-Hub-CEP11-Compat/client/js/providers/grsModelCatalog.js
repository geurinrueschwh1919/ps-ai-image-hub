(function defineGrsModelCatalog(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGrsModelCatalog() {
  "use strict";
  var STANDARD_RATIOS = Object.freeze(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"]);
  var NANO_2_EXTENDED_RATIOS = Object.freeze(STANDARD_RATIOS.concat(["1:4", "4:1", "1:8", "8:1"]));
  var REPLY_TYPES = Object.freeze(["json", "stream", "async"]);
  var GPT_IMAGE_2_RATIOS = Object.freeze(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1"]);
  var GPT_IMAGE_2_VIP_RESOLUTION_MAP = Object.freeze({
    "1:1": Object.freeze({ "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" }),
    "16:9": Object.freeze({ "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" }),
    "9:16": Object.freeze({ "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" }),
    "4:3": Object.freeze({ "1K": "1152x864", "2K": "2304x1728", "4K": "3264x2448" }),
    "3:4": Object.freeze({ "1K": "864x1152", "2K": "1728x2304", "4K": "2448x3264" }),
    "3:2": Object.freeze({ "1K": "1536x1024", "2K": "2048x1360", "4K": "3504x2336" }),
    "2:3": Object.freeze({ "1K": "1024x1536", "2K": "1360x2048", "4K": "2336x3504" }),
    "5:4": Object.freeze({ "1K": "1120x896", "2K": "2240x1792", "4K": "3200x2560" }),
    "4:5": Object.freeze({ "1K": "896x1120", "2K": "1792x2240", "4K": "2560x3200" }),
    "21:9": Object.freeze({ "1K": "1456x624", "2K": "2912x1248", "4K": "3840x1648" }),
    "9:21": Object.freeze({ "1K": "624x1456", "2K": "1248x2912", "4K": "1648x3840" }),
    "1:3": Object.freeze({ "2K": "688x2048", "4K": "1280x3840" }),
    "3:1": Object.freeze({ "2K": "2048x688", "4K": "3840x1280" }),
    "2:1": Object.freeze({ "1K": "1536x768", "2K": "3072x1536", "4K": "3840x1920" }),
    "1:2": Object.freeze({ "1K": "768x1536", "2K": "1536x3072", "4K": "1920x3840" })
  });
  var GPT_IMAGE_2_VIP_RATIOS = Object.freeze(Object.keys(GPT_IMAGE_2_VIP_RESOLUTION_MAP));
  var COMMON = Object.freeze({ supportsTextToImage: true, supportsImageToImage: true, supportsMultipleReferences: true, referenceInputFormats: ["base64", "url"] });
  var CURRENT_NANO = [
    ["nano-banana-pro", "Nano Banana Pro", ["1K", "2K", "4K"], 1800, false], ["nano-banana-fast", "Nano Banana Fast", null, 440, false],
    ["nano-banana-pro-vt", "Nano Banana Pro VT", ["1K", "2K", "4K"], 1800, false], ["nano-banana-2", "Nano Banana 2", ["1K", "2K", "4K"], 1200, true],
    ["nano-banana-2-lite", "Nano Banana 2 Lite", null, 440, false], ["nano-banana-pro-cl", "Nano Banana Pro CL", ["1K"], 10000, false],
    ["nano-banana-2-cl", "Nano Banana 2 CL", ["1K"], 6000, true], ["nano-banana-2-2k-cl", "Nano Banana 2 2K CL", ["2K"], 9000, true],
    ["nano-banana-pro-vip", "Nano Banana Pro VIP", ["1K", "2K"], 10000, false], ["nano-banana-pro-4k-vip", "Nano Banana Pro 4K VIP", ["4K"], 18000, false],
    ["nano-banana-2-4k-cl", "Nano Banana 2 4K CL", ["4K"], 13000, true]
  ];
  function layers(currentSizes, legacySizes, family) {
    return { currentCatalogCapabilities: Object.assign({}, COMMON, { supportedImageSizes: currentSizes ? currentSizes.slice() : null }),
      newApiCapabilities: Object.assign({}, COMMON, {
        requestImageField: "images",
        resolutionTierField: family === "nano-banana" && currentSizes ? "imageSize" : family === "gpt-image" ? "aspectRatio" : null,
        resolutionMappingStatus: currentSizes ? "CONFIRMED" : "UNKNOWN"
      }),
      legacyApiCapabilities: Object.assign({}, COMMON, { endpoint: family === "gpt-image" ? "/v1/draw/completions" : "/v1/draw/nano-banana", resultEndpoint: "/v1/draw/result", requestImageField: "urls", supportedImageSizes: legacySizes ? legacySizes.slice() : null, quality: family === "gpt-image" ? ["auto", "low", "medium", "high"] : null }) };
  }
  function nano(def) {
    var sizes = def[2];
    return Object.assign({ id: def[0], modelId: def[0], displayName: def[1], family: "nano-banana", requestFamily: "nano-banana", currentCatalogListed: true, legacyDocumented: true,
      currentCatalogCostCredits: def[3], supportedAspectRatios: (def[4] ? NANO_2_EXTENDED_RATIOS : STANDARD_RATIOS).slice(), currentCatalogSupportedImageSizes: sizes ? sizes.slice() : null,
      resolutionTiers: sizes ? sizes.slice() : null,
      legacySupportedImageSizes: sizes ? sizes.slice() : null, supportedImageSizes: sizes ? sizes.slice() : null, replyTypes: REPLY_TYPES.slice(), documentedCapabilities: Object.assign({}, COMMON) }, layers(sizes, sizes, "nano-banana"));
  }
  var GRS_NANO_MODELS = Object.freeze(CURRENT_NANO.map(nano));
  function gpt(id, name, sizes, cost, ratios, tierMap) {
    var model = Object.assign({ id: id, modelId: id, displayName: name, family: "gpt-image", requestFamily: "gpt-image", currentCatalogListed: true, legacyDocumented: true,
      currentCatalogCostCredits: cost, currentCatalogSupportedImageSizes: sizes.slice(), resolutionTiers: sizes.slice(), supportedImageSizes: [], supportedAspectRatios: ratios.slice(),
      resolutionTiersByAspectRatio: tierMap || null, replyTypes: REPLY_TYPES.slice(), documentedCapabilities: Object.assign({}, COMMON) }, layers(sizes, null, "gpt-image"));
    model.newApiCapabilities = Object.assign({}, model.newApiCapabilities, {
      resolutionTierField: "aspectRatio",
      resolutionMappingStatus: tierMap ? "CONFIRMED_PIXEL_MATRIX" : "CONFIRMED_RATIO_OR_1K_PIXEL"
    });
    return model;
  }
  var GRS_GPT_MODELS = Object.freeze([
    gpt("gpt-image-2", "GPT Image 2", ["1K"], 600, GPT_IMAGE_2_RATIOS, null),
    gpt("gpt-image-2-vip", "GPT Image 2 VIP", ["1K", "2K", "4K"], 2000, GPT_IMAGE_2_VIP_RATIOS, GPT_IMAGE_2_VIP_RESOLUTION_MAP)
  ]);
  var legacyNano = Object.assign({ id: "nano-banana", modelId: "nano-banana", displayName: "Nano Banana", family: "nano-banana", requestFamily: "nano-banana", currentCatalogListed: false, legacyDocumented: true,
    supportedAspectRatios: STANDARD_RATIOS.slice(), supportedImageSizes: ["1K", "2K", "4K"], legacySupportedImageSizes: ["1K", "2K", "4K"], replyTypes: REPLY_TYPES.slice(), documentedCapabilities: Object.assign({}, COMMON) }, layers(null, ["1K", "2K", "4K"], "nano-banana"));
  var GRS_LEGACY_ONLY_MODELS = Object.freeze([legacyNano]);
  var GRS_MODEL_CATALOG = Object.freeze(GRS_NANO_MODELS.concat(GRS_GPT_MODELS));
  var GRS_COMPATIBILITY_CATALOG = Object.freeze(GRS_MODEL_CATALOG.concat(GRS_LEGACY_ONLY_MODELS));
  function getGrsModel(modelId) { return GRS_COMPATIBILITY_CATALOG.find(function match(model) { return model.modelId === modelId; }) || null; }
  function resolveGptVipPixelSize(aspectRatio, resolutionTier) {
    var tiers = GPT_IMAGE_2_VIP_RESOLUTION_MAP[String(aspectRatio || "")];
    return tiers && tiers[String(resolutionTier || "")] || null;
  }
  return { GRS_STANDARD_RATIOS: STANDARD_RATIOS, GRS_NANO_2_EXTENDED_RATIOS: NANO_2_EXTENDED_RATIOS, GRS_IMAGE_SIZES: Object.freeze(["1K", "2K", "4K"]), GRS_REPLY_TYPES: REPLY_TYPES,
    GRS_NANO_MODELS: GRS_NANO_MODELS, GRS_GPT_MODELS: GRS_GPT_MODELS, GRS_LEGACY_ONLY_MODELS: GRS_LEGACY_ONLY_MODELS, GRS_MODEL_CATALOG: GRS_MODEL_CATALOG,
    GRS_COMPATIBILITY_CATALOG: GRS_COMPATIBILITY_CATALOG, GPT_IMAGE_2_VIP_RESOLUTION_MAP: GPT_IMAGE_2_VIP_RESOLUTION_MAP,
    resolveGptVipPixelSize: resolveGptVipPixelSize, getGrsModel: getGrsModel, GRS_FUTURE_COMPATIBILITY: Object.freeze({ geminiCompatibleNanoPath: "metadata-only" }) };
}));
