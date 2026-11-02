(function defineAliyunBailianCatalog(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAliyunBailianCatalog() {
  "use strict";

  var PROVIDER_ID = "aliyun-bailian";
  var CONFIG_SCHEMA_VERSION = 3;
  var REGION_CATALOG = Object.freeze([
    Object.freeze({
      id: "cn-beijing",
      label: "北京",
      dedicatedSuffix: ".cn-beijing.maas.aliyuncs.com",
      sharedBaseUrl: "https://dashscope.aliyuncs.com"
    }),
    Object.freeze({ id: "ap-southeast-1", label: "新加坡", dedicatedSuffix: ".ap-southeast-1.maas.aliyuncs.com",
      sharedBaseUrl: "https://dashscope-intl.aliyuncs.com" }),
    Object.freeze({ id: "eu-central-1", label: "法兰克福", dedicatedSuffix: ".eu-central-1.maas.aliyuncs.com", sharedBaseUrl: "" }),
    Object.freeze({ id: "ap-northeast-1", label: "东京", dedicatedSuffix: ".ap-northeast-1.maas.aliyuncs.com", sharedBaseUrl: "" }),
    Object.freeze({ id: "cn-hongkong", label: "中国香港", dedicatedSuffix: ".cn-hongkong.maas.aliyuncs.com", sharedBaseUrl: "" })
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
    return "";
  }

  function getRegion(regionId) {
    var id = String(regionId || "").trim();
    return REGION_CATALOG.find(function match(region) { return region.id === id; }) || null;
  }

  function normalizeEndpointMode(value) {
    return String(value || "").trim() === "shared" ? "shared" : "dedicated";
  }

  function legacySharedRegion(value) {
    var baseUrl = String(value || "").trim().replace(/\/+$/, "").toLowerCase();
    if (!baseUrl) return "";
    var match = REGION_CATALOG.find(function findShared(region) {
      return region.sharedBaseUrl && region.sharedBaseUrl.toLowerCase() === baseUrl;
    });
    return match ? match.id : "";
  }

  function stripDedicatedApiPath(value) {
    var text = String(value || "").trim();
    return text.replace(/\/+$/, "").replace(/\/api\/v1(?:\/.*)?$/i, "");
  }

  function parseDedicatedApiHost(value) {
    var raw = stripDedicatedApiPath(value);
    if (!raw) return { valid: false, reason: "missing", origin: "", region: "", hostLabel: "" };
    var match = raw.match(/^https:\/\/([^\/?#@:]+)$/i);
    if (!match) return { valid: false, reason: /^http:\/\//i.test(raw) ? "https-required" : "invalid-url", origin: "", region: "", hostLabel: "" };
    var hostname = String(match[1] || "").toLowerCase();
    var region = REGION_CATALOG.find(function bySuffix(item) { return hostname.slice(-item.dedicatedSuffix.length) === item.dedicatedSuffix; });
    if (!region) return { valid: false, reason: "domain-not-allowed", origin: "", region: "", hostLabel: "" };
    var label = hostname.slice(0, -region.dedicatedSuffix.length);
    if (!label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { valid: false, reason: "unsafe-host-label", origin: "", region: "", hostLabel: "" };
    }
    return { valid: true, reason: "", origin: "https://" + hostname, region: region.id, hostLabel: label };
  }

  function migrateLegacyDedicatedHost(source, region) {
    var direct = parseDedicatedApiHost(source.dedicatedApiHost || source.workspaceApiHost || "");
    if (direct.valid) return direct.origin;
    var legacy = String(source.workspaceId || "").trim().toLowerCase();
    var regionEntry = getRegion(region);
    if (legacy && /^llm-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(legacy) && regionEntry) {
      return "https://" + legacy + regionEntry.dedicatedSuffix;
    }
    return "";
  }

  function resolveBaseUrl(regionId, dedicatedApiHost, endpointMode) {
    var region = getRegion(regionId);
    var mode = normalizeEndpointMode(endpointMode);
    if (!region) return "";
    if (mode === "shared") return region.sharedBaseUrl;
    var parsed = parseDedicatedApiHost(dedicatedApiHost);
    return parsed.valid && parsed.region === region.id ? parsed.origin : "";
  }

  function buildSubmitUrl(dedicatedApiHost, regionId, endpointMode) {
    var baseUrl = resolveBaseUrl(regionId, dedicatedApiHost, endpointMode);
    return baseUrl ? baseUrl + "/api/v1/services/aigc/image-generation/generation" : "";
  }

  function buildPollUrl(dedicatedApiHost, regionId, taskId, endpointMode) {
    var baseUrl = resolveBaseUrl(regionId, dedicatedApiHost, endpointMode);
    var id = String(taskId || "");
    return baseUrl && id ? baseUrl + "/api/v1/tasks/" + encodeURIComponent(id) : "";
  }

  function normalizeConfig(input) {
    var source = input || {};
    var modelId = String(source.modelId || "qwen-image-3.0").trim();
    if (!getModel(modelId)) modelId = "qwen-image-3.0";
    var legacyRegion = legacySharedRegion(source.baseUrl);
    var region = Object.prototype.hasOwnProperty.call(source, "region") ? String(source.region || "").trim() : legacyRegion;
    if (region && !isRegionSupported(modelId, region)) region = "";
    var endpointMode = String(source.endpointMode || "").trim();
    if (endpointMode === "workspace") endpointMode = "dedicated";
    if (!endpointMode) endpointMode = legacyRegion && !source.workspaceId ? "shared" : "dedicated";
    endpointMode = normalizeEndpointMode(endpointMode);
    var dedicatedApiHost = migrateLegacyDedicatedHost(source, region);
    return {
      id: PROVIDER_ID,
      displayName: "阿里云百炼",
      type: PROVIDER_ID,
      region: region,
      endpointMode: endpointMode,
      dedicatedApiHost: dedicatedApiHost,
      configSchemaVersion: CONFIG_SCHEMA_VERSION,
      providerConfigRevision: Math.max(0, Math.floor(Number(source.providerConfigRevision) || 0)),
      modelId: modelId,
      models: MODEL_CATALOG.slice(),
      baseUrl: resolveBaseUrl(region, dedicatedApiHost, endpointMode),
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
    ALIYUN_BAILIAN_CONFIG_SCHEMA_VERSION: CONFIG_SCHEMA_VERSION,
    ALIYUN_BAILIAN_REGION_CATALOG: REGION_CATALOG,
    ALIYUN_BAILIAN_MODEL_CATALOG: MODEL_CATALOG,
    ALIYUN_BAILIAN_SIZE_PRESETS: SIZE_PRESETS,
    normalizeAliyunBailianConfig: normalizeConfig,
    getAliyunBailianModel: getModel,
    getAliyunBailianSupportedRegions: getSupportedRegions,
    isAliyunBailianRegionSupported: isRegionSupported,
    resolveAliyunBailianSupportedRegion: resolveSupportedRegion,
    getAliyunBailianRegion: getRegion,
    normalizeAliyunBailianEndpointMode: normalizeEndpointMode,
    parseAliyunDedicatedApiHost: parseDedicatedApiHost,
    normalizeAliyunDedicatedApiHost: function normalizeHost(value) { var parsed = parseDedicatedApiHost(value); return parsed.valid ? parsed.origin : ""; },
    inferAliyunRegionFromLegacyBaseUrl: legacySharedRegion,
    resolveAliyunBailianBaseUrl: resolveBaseUrl,
    buildBailianSubmitUrl: buildSubmitUrl,
    buildBailianPollUrl: buildPollUrl,
    resolveAliyunBailianSize: resolveSize,
    validateAliyunBailianPixelSize: validatePixelSize
  };
}));
