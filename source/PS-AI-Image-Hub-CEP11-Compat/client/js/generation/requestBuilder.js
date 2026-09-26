(function defineRequestBuilder(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var imageInputs = typeof module === "object" && module.exports ? require("./imageInputSet") : root.PSAIImageHubCompat;
  var api = factory(errors, imageInputs);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createRequestBuilder(errors, imageInputs) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  function buildGenerationRequest(input) {
    var inputSet = imageInputs.createImageInputSet(input.imageInputs || {
      mainImage: input.mainImage || null,
      referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : input.references
    });
    return {
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: String(input.finalPrompt || input.prompt || "").trim(),
      finalPrompt: String(input.finalPrompt || input.prompt || "").trim(),
      aspectRatio: input.aspectRatio || "1:1",
      count: input.count || 1,
      resolutionTier: input.resolutionTier || input.imageSize || null,
      // Kept as a compatibility alias for older Provider adapters and history entries.
      imageSize: input.imageSize || input.resolutionTier || null,
      replyType: input.replyType || (input.providerId === "grs" ? "async" : "json"),
      imageInputs: inputSet,
      mainImage: inputSet.mainImage,
      referenceImages: inputSet.referenceImages.slice(),
      references: imageInputs.orderedImageInputs(inputSet),
      mask: null,
      negativePrompt: String(input.negativePrompt || ""),
      seed: input.seed === undefined || input.seed === null ? "" : input.seed,
      promptExtend: input.promptExtend !== false,
      promptExtendMode: String(input.promptExtendMode || "direct"),
      enableThinking: input.enableThinking !== false
    };
  }

  function joinUrl(baseUrl, endpointPath) {
    var base = String(baseUrl || "").trim();
    var endpoint = String(endpointPath || "").trim();
    if (!/^https?:\/\//i.test(base)) throw new AppError(ErrorCodes.MISSING_BASE_URL, "Base URL must use HTTP or HTTPS.");
    if (!endpoint) throw new AppError(ErrorCodes.MISSING_ENDPOINT, "Endpoint is required.");
    if (/^https?:\/\//i.test(endpoint)) return endpoint;
    return base.replace(/\/+$/, "") + "/" + endpoint.replace(/^\/+/, "");
  }

  function buildHeaders(config, apiKey) {
    var headers = { "Content-Type": "application/json" };
    var authType = config.authType || "bearer";
    if (authType !== "none" && !apiKey) throw new AppError(ErrorCodes.MISSING_API_KEY, "API key is required.");
    if (authType === "bearer") headers.Authorization = "Bearer " + apiKey;
    else if (authType === "x-api-key") headers["x-api-key"] = apiKey;
    else if (authType === "custom-header") {
      var name = String(config.customHeaderName || "").trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Custom authentication header name is invalid.");
      }
      headers[name] = apiKey;
    } else if (authType !== "none") {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Unsupported authentication type.");
    }
    return headers;
  }

  function replaceTemplate(value, variables) {
    if (Array.isArray(value)) return value.map(function map(item) { return replaceTemplate(item, variables); });
    if (value && typeof value === "object") {
      return Object.keys(value).reduce(function reduce(result, key) {
        result[key] = replaceTemplate(value[key], variables);
        return result;
      }, {});
    }
    if (typeof value !== "string") return value;
    var exact = value.match(/^\{\{(prompt|modelId|aspectRatio|count)\}\}$/);
    if (exact) return variables[exact[1]];
    return value.replace(/\{\{(prompt|modelId|aspectRatio|count)\}\}/g, function substitute(all, name) {
      return String(variables[name]);
    });
  }

  function renderJsonBody(template, request) {
    var source = String(template || '{"model":"{{modelId}}","prompt":"{{prompt}}","aspect_ratio":"{{aspectRatio}}","count":"{{count}}"}');
    var parsed;
    try { parsed = JSON.parse(source); }
    catch (error) { throw new AppError(ErrorCodes.INVALID_REQUEST_TEMPLATE, "Request body template is not valid JSON."); }
    return replaceTemplate(parsed, request);
  }

  function mapOpenAIImageSize(aspectRatio) {
    if (aspectRatio === "1:1") return "1024x1024";
    var parts = String(aspectRatio || "").split(":").map(Number);
    if (parts.length === 2 && parts[0] > parts[1]) return "1536x1024";
    if (parts.length === 2 && parts[0] < parts[1]) return "1024x1536";
    return "1024x1024";
  }

  function buildOpenAICompatibleHttpRequest(request, config, apiKey) {
    return {
      url: joinUrl(config.baseUrl, config.endpointPath),
      method: "POST",
      headers: buildHeaders(config, apiKey),
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.prompt,
        n: request.count || 1,
        size: mapOpenAIImageSize(request.aspectRatio),
        output_format: "png"
      })
    };
  }

  function buildGenericRestHttpRequest(request, config, apiKey) {
    return {
      url: joinUrl(config.baseUrl, config.endpointPath),
      method: String(config.httpMethod || "POST").toUpperCase(),
      headers: buildHeaders(config, apiKey),
      body: JSON.stringify(renderJsonBody(config.requestBodyTemplate, request))
    };
  }

  return {
    buildGenerationRequest: buildGenerationRequest,
    joinUrl: joinUrl,
    buildHeaders: buildHeaders,
    renderJsonBody: renderJsonBody,
    mapOpenAIImageSize: mapOpenAIImageSize,
    buildOpenAICompatibleHttpRequest: buildOpenAICompatibleHttpRequest,
    buildGenericRestHttpRequest: buildGenericRestHttpRequest
  };
}));
