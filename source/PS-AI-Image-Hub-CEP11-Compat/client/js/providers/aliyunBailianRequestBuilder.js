(function defineAliyunBailianRequestBuilder(root, factory) {
  "use strict";
  var imageInputs = typeof module === "object" && module.exports ? require("../generation/imageInputSet") : root.PSAIImageHubCompat;
  var catalog = typeof module === "object" && module.exports ? require("./aliyunBailianCatalog") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var api = factory(imageInputs, catalog, errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAliyunBailianRequestBuilder(imageInputs, catalog, errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var MAX_INPUT_IMAGES = 3;
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  var MAX_SEED = 2147483647;
  var SUPPORTED_MIME = Object.freeze(["image/jpeg", "image/png", "image/bmp", "image/tiff", "image/webp", "image/gif"]);

  function rawBase64(value) {
    var match = String(value || "").match(/^data:([^;,]+);base64,([\s\S]*)$/i);
    return match ? { mimeType: String(match[1]).toLowerCase(), data: match[2].replace(/\s+/g, "") } : null;
  }

  function decodedBase64Bytes(value) {
    var data = String(value || "").replace(/\s+/g, "");
    if (!data) return 0;
    var padding = /==$/.test(data) ? 2 : /=$/.test(data) ? 1 : 0;
    return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
  }

  function imageValue(image) {
    if (image && typeof image.url === "string" && /^https?:\/\//i.test(image.url)) return image.url;
    var source = image && (image.apiValue || image.base64) || "";
    var parsed = rawBase64(source);
    var mimeType = parsed ? parsed.mimeType : String(image && image.mimeType || "image/png").toLowerCase();
    var data = parsed ? parsed.data : String(source).replace(/\s+/g, "");
    if (!data) throw new AppError(ErrorCodes.IMAGE_PAYLOAD_BUILD_FAILED, "Bailian input image has no API-ready Base64 data.");
    if (SUPPORTED_MIME.indexOf(mimeType) === -1) {
      throw new AppError(ErrorCodes.UNSUPPORTED_IMAGE_FILE, "Bailian input image format is not supported.", { mimeType: mimeType });
    }
    if (decodedBase64Bytes(data) > MAX_IMAGE_BYTES) {
      throw new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, "Bailian input image exceeds 10 MB.", { maxBytes: MAX_IMAGE_BYTES });
    }
    return "data:" + mimeType + ";base64," + data;
  }

  function validSeed(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    var number = Number(value);
    if (!isFinite(number) || Math.floor(number) !== number || number < 0 || number > MAX_SEED) {
      throw new AppError(ErrorCodes.INVALID_SEED, "Seed must be an integer from 0 to 2147483647.");
    }
    return number;
  }

  function buildBody(request) {
    var modelId = String(request && request.modelId || "");
    if (!catalog.ALIYUN_BAILIAN_MODEL_CATALOG.some(function match(model) { return model.id === modelId; })) {
      throw new AppError(ErrorCodes.MODEL_REQUIRED, "Unsupported Bailian Qwen Image Model ID.");
    }
    var ordered = imageInputs.orderedImageInputs(request && request.imageInputs || {});
    if (ordered.length > MAX_INPUT_IMAGES) {
      throw new AppError(ErrorCodes.INPUT_IMAGE_LIMIT,
        "Qwen Image 3.0 supports at most 3 input images.", { maxInputImages: MAX_INPUT_IMAGES, imageCount: ordered.length });
    }
    var content = ordered.map(function map(image) { return { image: imageValue(image) }; });
    content.push({ text: String(request && request.prompt || "") });
    var promptExtend = request && request.promptExtend !== false;
    var promptExtendMode = String(request && request.promptExtendMode || "direct");
    if (["direct", "agent"].indexOf(promptExtendMode) === -1) promptExtendMode = "direct";
    if (ordered.length && promptExtendMode === "agent") promptExtendMode = "direct";
    var parameters = {
      prompt_extend: promptExtend,
      prompt_extend_mode: promptExtendMode,
      n: 1
    };
    if (promptExtend) parameters.enable_thinking = request && request.enableThinking !== false;
    var size = catalog.resolveAliyunBailianSize(request && request.aspectRatio, request && request.resolutionTier || "auto");
    if (size === undefined) throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Bailian output size preset is invalid.");
    if (size !== null) {
      if (!catalog.validateAliyunBailianPixelSize(size)) throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Bailian output size violates documented constraints.");
      parameters.size = size;
    }
    var negativePrompt = String(request && request.negativePrompt || "").trim();
    if (negativePrompt) parameters.negative_prompt = negativePrompt;
    var seed = validSeed(request && request.seed);
    if (seed !== null) parameters.seed = seed;
    return {
      model: modelId,
      input: { messages: [{ role: "user", content: content }] },
      parameters: parameters
    };
  }

  return {
    ALIYUN_BAILIAN_MAX_INPUT_IMAGES: MAX_INPUT_IMAGES,
    ALIYUN_BAILIAN_MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    ALIYUN_BAILIAN_MAX_SEED: MAX_SEED,
    buildAliyunBailianRequestBody: buildBody,
    aliyunBailianImageValue: imageValue,
    decodedBase64ByteLength: decodedBase64Bytes,
    validateAliyunBailianSeed: validSeed
  };
}));
