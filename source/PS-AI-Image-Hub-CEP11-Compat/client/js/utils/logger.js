(function defineLogger(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createLogger() {
  "use strict";
  var SECRET_KEYS = /api[-_]?key|authorization|bearer|token|secret/i;

  function maskApiKey(value) {
    var secret = String(value || "");
    if (!secret) return "";
    var prefix = secret.indexOf("sk-") === 0 ? "sk-" : secret.slice(0, Math.min(3, secret.length));
    var suffix = secret.length > 4 ? secret.slice(-4) : "";
    return prefix + "****" + suffix;
  }

  function redact(value, seen) {
    if (typeof value === "string") {
      return value
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
    }
    if (value === null || value === undefined || typeof value !== "object") return value;
    var visited = seen || [];
    if (visited.indexOf(value) !== -1) return "[Circular]";
    visited.push(value);
    if (value instanceof Error) {
      return { name: value.name, code: value.code, message: value.message, details: redact(value.details, visited) };
    }
    if (Array.isArray(value)) return value.map(function map(item) { return redact(item, visited); });
    return Object.keys(value).reduce(function reduce(result, key) {
      if (/api[-_]?key/i.test(key) && typeof value[key] === "string") result[key] = maskApiKey(value[key]);
      else result[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redact(value[key], visited);
      return result;
    }, {});
  }

  function write(method, message, data) {
    if (data === undefined) console[method]("[PS AI Image Hub CEP] " + message);
    else console[method]("[PS AI Image Hub CEP] " + message, redact(data));
  }

  var logger = {
    info: function info(message, data) { write("log", message, data); },
    warn: function warn(message, data) { write("warn", message, data); },
    error: function error(message, data) { write("error", message, data); }
  };

  var PIPELINE_FIELDS = Object.freeze(["sourceType", "width", "height", "fileSizeBytes", "bytesRead", "base64Length",
    "hasMainImage", "mainImageCount", "referenceCount", "model", "imageCount", "aspectRatio", "resolutionTier", "imageSize",
    "payloadBytes", "requestPayloadBytes", "beforeOptimizationPayloadBytes", "afterOptimizationPayloadBytes", "reductionPercent",
    "softTargetBytes", "passCount", "sourceDimensions", "sentDimensions", "encodedBytesPerImage", "endpoint", "effectiveTimeoutMs",
    "exportMs", "readMs", "optimizeMs", "encodeMs", "serializeMs", "requestRoundTripBeforeTaskMs", "xhrSendToFirstResponseMs",
    "taskWaitMs", "downloadMs", "importMs", "totalMs", "taskId", "responseStatus", "originalWidth", "originalHeight",
    "targetWidth", "targetHeight", "calculatedScale", "appliedScale", "resizeApplied", "upscalePrevented", "importPathType",
    "usedSmartObjectUpscale", "historyReimportUsedSavedContext", "currentDocumentMatchesSavedImportContext"]);

  function logImagePipeline(phase, eventName, details) {
    var safe = { phase: Number(phase), event: String(eventName || "") };
    PIPELINE_FIELDS.forEach(function copy(name) {
      if (details && details[name] !== undefined && details[name] !== null) safe[name] = details[name];
    });
    logger.info("Image request pipeline", safe);
    return safe;
  }

  return { logger: logger, redact: redact, maskApiKey: maskApiKey, logImagePipeline: logImagePipeline };
}));
