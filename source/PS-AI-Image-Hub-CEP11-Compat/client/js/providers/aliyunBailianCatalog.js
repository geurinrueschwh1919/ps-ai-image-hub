(function defineAliyunBailianCatalog(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAliyunBailianCatalog() {
  "use strict";

  var PROVIDER_ID = "aliyun-bailian";
  var REGION_CATALOG = Object.freeze([
    Object.freeze({
      id: "cn-beijing",
      label: "北京",
      hostTemplate: "https://{workspaceId}.{region}.maas.aliyuncs.com"
    }),
    Object.freeze({ id: "ap-southeast-1", label: "新加坡", hostTemplate: "https://{workspaceId}.{region}.maas.aliyuncs.com" }),
    Object.freeze({ id: "eu-central-1", label: "法兰克福", hostTemplate: "https://{workspaceId}.{region}.maas.aliyuncs.com" }),
    Object.freeze({ id: "ap-northeast-1", label: "东京", hostTemplate: "https://{workspaceId}.{region}.maas.aliyuncs.com" }),
    Object.freeze({ id: "cn-hongkong", label: "中国香港", hostTemplate: "https://{workspaceId}.{region}.maas.aliyuncs.com" })
  ]);
  var QWEN_IMAGE_3_SUPPORTED_REGIONS = Object.freeze(["cn-beijing", "ap-southeast-1"]);
  var SIZE_PRESETS = Object.freeze({
    "1:1": Object.freeze({ auto: null, "1K": "1024*1024", "2K": "2048*2048" }),
    "16:9": Object.freeze({ auto: null, "1K": "1344*768", "2K": "1920*1080" }),
    "9:16": Object.freeze({ auto: null, "1K": "768*1344", "2K": "1080*1920" }),
    "4:3": Object.freeze({ auto: null, "1K": "1152*864", "2K": "2048*1536" }),
    "3:4": Object.freeze({ auto: null, "1K": "864*1152", "2K": "1536*2048" }),
    "3:2": Object.freeze({ auto: null, "1K": "1536*1024", "2K": "1920*1280" }),
    "2:3": Object.freeze({ auto: null, "1K": "1024*1536", "2K": "1280*1920" })
  });
  var RESOLUTION_LABELS = Object.freeze({ auto: "自动", "1K": "1K", "2K": "2K" });

  function createModel(id, displayName) {
    return Object.freeze({
      id: id,
      modelId: id,
      displayName: displayName,
      family: "qwen-image-3.0",
      requestFamily: "qwen-image-3.0",
      supportedRegions: QWEN_IMAGE_3_SUPPORTED_REGIONS,
      supportedAspectRatios: Object.freeze(Object.keys(SIZE_PRESETS)),
      supportedImageSizes: Object.freeze(["auto", "1K", "2K"]),
      resolutionTiersByAspectRatio: SIZE_PRESETS,
      resolutionTierLabels: RESOLUTION_LABELS,
      supportsTextToImage: true,
      supportsImageToImage: true,
      supportsMultipleReferences: true,
      maxReferenceImages: 3,
      maxInputImages: 3,
      outputFormat: "png",
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsPromptExtend: true,
      supportsThinking: true,
      supportsMultipleOutputs: true,
      supportsWatermark: true,
      supportsAsync: true,
      temporaryResultUrls: true,
      showsBillingNotice: true
    });
  }

  var MODEL_CATALOG = Object.freeze([
    createModel("qwen-image-3.0", "Qwen Image 3.0"),
    createModel("qwen-image-3.0-pro", "Qwen Image 3.0 Pro")
  ]);

  function getModel(modelId) {
    var id = String(modelId || "").trim();
    return MODEL_CATALOG.find(function match(model) { return model.id === id; }) || null;
  }

  function getSupportedRegions(modelId) {
    var model = getModel(modelId);
    var supported = model && Array.isArray(model.supportedRegions) ? model.supportedRegions : [];
    return REGION_CATALOG.filter(function supportedRegion(region) { return supported.indexOf(region.id) !== -1; });
  }

  function isRegionSupported(modelId, regionId) {
    var model = getModel(modelId);
    return Boolean(model && model.supportedRegions.indexOf(String(regionId || "").trim()) !== -1);
  }

  function resolveSupportedRegion(modelId, regionId) {
    var requested = String(regionId || "").trim();
    if (requested && isRegionSupported(modelId, requested)) return requested;
    var supported = getSupportedRegions(modelId);
    return supported.length ? supported[0].id : "";
  }

  function getRegion(regionId) {
    var id = String(regionId || "cn-beijing").trim();
    return REGION_CATALOG.find(function match(region) { return region.id === id; }) || null;
  }

  function normalizeWorkspaceId(value) { return String(value || "").trim(); }

  function isSafeWorkspaceId(value) {
    var workspaceId = normalizeWorkspaceId(value);
    return Boolean(workspaceId && workspaceId.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(workspaceId));
  }

  function resolveBaseUrl(regionId, workspaceId) {
    var region = getRegion(regionId);
    var workspace = normalizeWorkspaceId(workspaceId);
    if (!region || !isSafeWorkspaceId(workspace)) return "";
    return region.hostTemplate.replace("{workspaceId}", workspace).replace("{region}", region.id);
  }

  function buildSubmitUrl(workspaceId, regionId) {
    var baseUrl = resolveBaseUrl(regionId, workspaceId);
    return baseUrl ? baseUrl + "/api/v1/services/aigc/image-generation/generation" : "";
  }

  function buildPollUrl(workspaceId, regionId, taskId) {
    var baseUrl = resolveBaseUrl(regionId, workspaceId);
    var id = String(taskId || "");
    return baseUrl && id ? baseUrl + "/api/v1/tasks/" + encodeURIComponent(id) : "";
  }

  function normalizeConfig(input) {
    var source = input || {};
    var modelId = String(source.modelId || "qwen-image-3.0").trim();
    if (!getModel(modelId)) modelId = "qwen-image-3.0";
    var hasRegion = Object.prototype.hasOwnProperty.call(source, "region");
    var region = hasRegion ? String(source.region || "").trim() : "cn-beijing";
    if (region && !isRegionSupported(modelId, region)) region = resolveSupportedRegion(modelId, region);
    var workspaceId = normalizeWorkspaceId(source.workspaceId);
    return {
      id: PROVIDER_ID,
      displayName: "阿里云百炼",
      type: PROVIDER_ID,
      region: region,
      workspaceId: workspaceId,
      modelId: modelId,
      models: MODEL_CATALOG.slice(),
      baseUrl: resolveBaseUrl(region, workspaceId),
      endpointPath: "/api/v1/services/aigc/image-generation/generation",
      authType: "bearer",
      contentType: "application/json"
    };
  }

  function resolveSize(aspectRatio, resolutionTier) {
    var ratio = String(aspectRatio || "");
    var tier = String(resolutionTier || "auto");
    var ratioPresets = SIZE_PRESETS[ratio];
    if (!ratioPresets || !Object.prototype.hasOwnProperty.call(ratioPresets, tier)) return undefined;
    return ratioPresets[tier];
  }

  function validatePixelSize(value) {
    if (value === null || value === undefined || value === "") return true;
    var match = String(value).match(/^(\d+)\*(\d+)$/);
    if (!match) return false;
    var width = Number(match[1]), height = Number(match[2]);
    var area = width * height;
    var ratio = Math.max(width / height, height / width);
    return area >= 512 * 512 && area <= 2048 * 2048 && ratio <= 8;
  }

  return {
    ALIYUN_BAILIAN_PROVIDER_ID: PROVIDER_ID,
    ALIYUN_BAILIAN_REGION_CATALOG: REGION_CATALOG,
    ALIYUN_BAILIAN_MODEL_CATALOG: MODEL_CATALOG,
    ALIYUN_BAILIAN_SIZE_PRESETS: SIZE_PRESETS,
    normalizeAliyunBailianConfig: normalizeConfig,
    getAliyunBailianModel: getModel,
    getAliyunBailianSupportedRegions: getSupportedRegions,
    isAliyunBailianRegionSupported: isRegionSupported,
    resolveAliyunBailianSupportedRegion: resolveSupportedRegion,
    getAliyunBailianRegion: getRegion,
    isSafeAliyunWorkspaceId: isSafeWorkspaceId,
    resolveAliyunBailianBaseUrl: resolveBaseUrl,
    buildBailianSubmitUrl: buildSubmitUrl,
    buildBailianPollUrl: buildPollUrl,
    resolveAliyunBailianSize: resolveSize,
    validateAliyunBailianPixelSize: validatePixelSize
  };
}));
