(function defineGrsLegacyAdapter(root, factory) {
  "use strict";
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var imageInputs = typeof module === "object" && module.exports ? require("../generation/imageInputSet") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var api = factory(builders, imageInputs, errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {}; Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGrsLegacyAdapter(builders, imageInputs, errors) {
  "use strict";
  var ENDPOINTS = Object.freeze({ nano: "/v1/draw/nano-banana", gpt: "/v1/draw/completions", result: "/v1/draw/result" });
  function values(request) { var ordered = request.imageInputs ? imageInputs.orderedImageInputs(request.imageInputs) : request.references || []; return ordered.map(function map(image) { return image && (image.base64 || image.url || image.apiValue) || null; }).filter(Boolean); }
  function buildGeneration(request, config, apiKey, model) {
    var family = model && (model.requestFamily || model.family);
    if (["nano-banana", "gpt-image"].indexOf(family) === -1) throw new errors.AppError(errors.ErrorCodes.INVALID_PROVIDER_CONFIG, "Legacy GRS request family is required.");
    var body = { model: request.modelId, prompt: request.prompt, aspectRatio: request.aspectRatio || "auto", urls: values(request), webHook: "", shutProgress: false };
    if (family === "nano-banana") body.imageSize = request.imageSize || config.imageSize || "1K"; else body.quality = request.quality || "auto";
    return { url: builders.joinUrl(config.baseUrl, family === "nano-banana" ? ENDPOINTS.nano : ENDPOINTS.gpt), method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey }, body: JSON.stringify(body), protocol: "legacy-api" };
  }
  function buildResult(baseUrl, taskId, apiKey) { return { url: builders.joinUrl(baseUrl, ENDPOINTS.result), method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey }, body: JSON.stringify({ id: taskId }), protocol: "legacy-api" }; }
  function parseResult(response) { if (!response || response.code !== 0 || !response.data) throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE, response && response.msg || "Legacy GRS result response is invalid."); if (["running", "succeeded", "failed", "violation"].indexOf(response.data.status) === -1) throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE_STATUS, "Legacy GRS task status is unknown."); return response.data; }
  return { GRS_LEGACY_ENDPOINTS: ENDPOINTS, buildGrsLegacyGenerationRequest: buildGeneration, buildGrsLegacyResultRequest: buildResult, parseGrsLegacyResult: parseResult };
}));
