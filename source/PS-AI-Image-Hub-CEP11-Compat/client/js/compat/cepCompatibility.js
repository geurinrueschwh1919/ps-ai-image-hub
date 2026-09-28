(function defineCepCompatibility(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createCepCompatibility(root) {
  "use strict";
  var SECRET_PATTERN = /api[-_]?key|authorization|secret|credential|bearer|token|base64|prompt|image(?:data|payload)?/i;

  function detectCepRuntime(scope) {
    var candidate = scope || root || {};
    var agent = String(candidate.navigator && candidate.navigator.userAgent || "unknown");
    var match = agent.match(/(?:CEP|CSXS)[\s\/-]?(\d+(?:\.\d+)*)/i);
    return { family: "CEP 11.x", reportedVersion: match ? match[1] : "unknown", userAgent: agent };
  }

  function redactDiagnostics(value, depth) {
    if (depth > 6) return "[TRUNCATED]";
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.slice(0, 300);
    if (Array.isArray(value)) return value.slice(0, 40).map(function map(item) { return redactDiagnostics(item, depth + 1); });
    if (typeof value !== "object") return String(value);
    return Object.keys(value).reduce(function reduce(result, key) {
      result[key] = SECRET_PATTERN.test(key) ? "[REDACTED]" : redactDiagnostics(value[key], depth + 1);
      return result;
    }, {});
  }

  function createBootCompatibilityReport(options) {
    var settings = options || {};
    return redactDiagnostics({
      build: "CEP11 Multi-Version Release",
      version: "1.0.2",
      host: settings.host || null,
      profile: settings.profile || "UNKNOWN_CEP11",
      cepRuntime: settings.cepRuntime || detectCepRuntime(root),
      cepCapabilities: settings.cepCapabilities || {},
      hostCapabilities: settings.hostCapabilities || {},
      fallbacks: settings.fallbacks || [],
      unsupportedCapabilities: settings.unsupportedCapabilities || []
    }, 0);
  }

  return { detectCepRuntime: detectCepRuntime, redactDiagnostics: redactDiagnostics,
    createBootCompatibilityReport: createBootCompatibilityReport };
}));
