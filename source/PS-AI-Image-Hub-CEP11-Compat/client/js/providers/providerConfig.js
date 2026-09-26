(function defineProviderConfig(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var objectPath = typeof module === "object" && module.exports ? require("../utils/objectPath") : root.PSAIImageHubCompat;
  var models = typeof module === "object" && module.exports ? require("./modelCatalog") : root.PSAIImageHubCompat;
  var api = factory(errors, objectPath, models);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createProviderConfig(errors, objectPath, models) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var TYPES = Object.freeze(["generic-rest", "openai-compatible", "async-task", "grs", "aliyun-bailian"]);

  function createProviderId() {
    return "custom-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  }

  function normalizeProviderConfig(input) {
    var source = input || {};
    return {
      id: String(source.id || createProviderId()).trim(),
      displayName: String(source.displayName || "").trim(),
      type: String(source.type || "generic-rest").trim(),
      baseUrl: String(source.baseUrl || "").trim(),
      endpointPath: String(source.endpointPath || "").trim(),
      modelId: String(source.modelId || "").trim(),
      models: models.normalizeModelList(source.models, source.modelId),
      authType: String(source.authType || "bearer").trim(),
      customHeaderName: String(source.customHeaderName || "").trim(),
      httpMethod: String(source.httpMethod || "POST").toUpperCase(),
      contentType: "application/json",
      resultType: String(source.resultType || "auto").trim(),
      responsePath: String(source.responsePath || "").trim(),
      requestBodyTemplate: String(source.requestBodyTemplate || "").trim(),
      pollingEndpoint: String(source.pollingEndpoint || "").trim(),
      pollingResultPath: String(source.pollingResultPath || "").trim()
    };
  }

  function validateProviderConfig(config, hasSecret) {
    var value = normalizeProviderConfig(config);
    var errorsList = [];
    var code = ErrorCodes.INVALID_PROVIDER_CONFIG;
    if (!value.id || !value.displayName || TYPES.indexOf(value.type) === -1) errorsList.push("Provider identity or type is invalid.");
    if (!/^https?:\/\//i.test(value.baseUrl)) { errorsList.push("Base URL is required."); code = ErrorCodes.MISSING_BASE_URL; }
    if (!value.endpointPath) { errorsList.push("Endpoint is required."); code = ErrorCodes.MISSING_ENDPOINT; }
    if (!value.modelId) errorsList.push("Model ID is required.");
    if (value.authType !== "none" && !hasSecret) { errorsList.push("API key is required."); code = ErrorCodes.MISSING_API_KEY; }
    if (value.authType === "custom-header" && !value.customHeaderName) errorsList.push("Custom header name is required.");
    if (value.type === "generic-rest" && !value.responsePath) errorsList.push("Response path is required.");
    if (value.type === "async-task" && (!value.responsePath || !value.pollingEndpoint || !value.pollingResultPath)) errorsList.push("Async task paths are incomplete.");
    [value.responsePath, value.pollingResultPath].filter(Boolean).forEach(function validatePath(path) {
      try { objectPath.parseObjectPath(path); }
      catch (error) { errorsList.push("JSON path is invalid."); code = ErrorCodes.INVALID_JSON_PATH; }
    });
    return { valid: errorsList.length === 0, errors: errorsList, code: code, config: value };
  }

  function requireValidProviderConfig(config, hasSecret) {
    var result = validateProviderConfig(config, hasSecret);
    if (!result.valid) throw new AppError(result.code, result.errors[0], { errors: result.errors });
    return result.config;
  }

  return {
    PROVIDER_TYPES: TYPES,
    createProviderId: createProviderId,
    normalizeProviderConfig: normalizeProviderConfig,
    validateProviderConfig: validateProviderConfig,
    requireValidProviderConfig: requireValidProviderConfig
  };
}));
