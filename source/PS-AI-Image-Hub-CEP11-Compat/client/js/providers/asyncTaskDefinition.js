(function defineAsyncTaskDefinition(root, factory) {
  "use strict";
  var paths = typeof module === "object" && module.exports ? require("../utils/objectPath") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var api = factory(paths, errors, builders);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAsyncTaskDefinition(paths, errors, builders) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var SCHEMA_VERSION = 1;

  function values(input, fallback) {
    var list = Array.isArray(input) ? input : input === undefined || input === null || input === "" ? fallback : [input];
    return (list || []).map(function stringValue(value) { return String(value); });
  }

  function numberValue(value, fallback, minimum) {
    var number = Number(value);
    return isFinite(number) && number >= minimum ? Math.floor(number) : fallback;
  }

  function normalizeSection(source, defaults) {
    return Object.assign({}, defaults || {}, source || {});
  }

  function normalizeAsyncTaskDefinition(input) {
    var source = input || {};
    var poll = normalizeSection(source.poll, {
      method: "GET", intervalMs: 3000, timeoutMs: 600000, requestTimeoutMs: 25000,
      maxAttempts: 201, temporaryFailureRetries: 3
    });
    poll.method = String(poll.method || "GET").toUpperCase();
    poll.intervalMs = numberValue(poll.intervalMs, 3000, 0);
    poll.timeoutMs = numberValue(poll.timeoutMs, 600000, 1);
    poll.requestTimeoutMs = numberValue(poll.requestTimeoutMs, 25000, 1);
    poll.maxAttempts = numberValue(poll.maxAttempts, 201, 1);
    poll.temporaryFailureRetries = numberValue(poll.temporaryFailureRetries, 3, 0);
    poll.unknownStatusLimit = numberValue(poll.unknownStatusLimit, 3, 1);
    var definition = {
      schemaVersion: numberValue(source.schemaVersion, SCHEMA_VERSION, 1),
      definitionVersion: numberValue(source.definitionVersion, 1, 1),
      id: String(source.id || "generic-async-v1"),
      protocolId: String(source.protocolId || "generic-async"),
      executionMode: "async",
      submit: normalizeSection(source.submit, { method: "POST", requestTimeoutMs: 25000 }),
      task: normalizeSection(source.task, { idPath: "id" }),
      poll: poll,
      status: normalizeSection(source.status, { path: "status" }),
      result: normalizeSection(source.result, { path: "output", type: "auto", mimeType: "image/png" }),
      error: normalizeSection(source.error, { path: "error" }),
      cancel: normalizeSection(source.cancel, { supported: false, method: "POST", requestTimeoutMs: 25000 })
    };
    definition.submit.method = String(definition.submit.method || "POST").toUpperCase();
    definition.submit.requestTimeoutMs = numberValue(definition.submit.requestTimeoutMs, 25000, 1);
    definition.cancel.supported = definition.cancel.supported === true;
    definition.cancel.method = String(definition.cancel.method || "POST").toUpperCase();
    definition.cancel.requestTimeoutMs = numberValue(definition.cancel.requestTimeoutMs, 25000, 1);
    definition.status.pendingValues = values(definition.status.pendingValues, ["pending", "starting", "processing", "running", "queued"]);
    definition.status.successValues = values(definition.status.successValues, ["succeeded"]);
    definition.status.failureValues = values(definition.status.failureValues, ["failed"]);
    definition.status.canceledValues = values(definition.status.canceledValues, ["canceled", "cancelled"]);
    return definition;
  }

  function validatePath(path, label, required, issues) {
    if (!path) { if (required) issues.push(label + " is required."); return; }
    try { paths.parseObjectPath(path); }
    catch (error) { issues.push(label + " is invalid."); }
  }

  function hasEndpoint(section) {
    return Boolean(section && (section.endpoint || section.endpointTemplate || section.endpointPath));
  }

  function validateAsyncTaskDefinition(input) {
    var definition = normalizeAsyncTaskDefinition(input);
    var issues = [];
    if (!definition.id) issues.push("Definition ID is required.");
    if (definition.schemaVersion !== SCHEMA_VERSION) issues.push("Async definition schema is unsupported.");
    if (!hasEndpoint(definition.submit)) issues.push("Submit endpoint is required.");
    if (!hasEndpoint(definition.poll)) issues.push("Polling endpoint is required.");
    validatePath(definition.task.idPath, "Task ID path", true, issues);
    validatePath(definition.status.path, "Status path", true, issues);
    validatePath(definition.poll.endpointPath, "Polling endpoint response path", false, issues);
    validatePath(definition.result.path, "Result path", true, issues);
    validatePath(definition.error.path, "Error path", false, issues);
    validatePath(definition.cancel.endpointPath, "Cancel endpoint response path", false, issues);
    if (definition.cancel.supported && !hasEndpoint(definition.cancel)) issues.push("Cancel endpoint is required when remote cancellation is supported.");
    ["pendingValues", "successValues", "failureValues", "canceledValues"].forEach(function nonEmpty(name) {
      if (!definition.status[name].length) issues.push("Status " + name + " must not be empty.");
    });
    return { valid: issues.length === 0, errors: issues, definition: definition };
  }

  function resolveAsyncPath(response, path) {
    if (response === null || response === undefined) return undefined;
    try { return paths.getByPath(response, path); }
    catch (error) { return undefined; }
  }

  function statusKind(definition, response) {
    var raw = resolveAsyncPath(response, definition.status.path);
    if (raw === undefined || raw === null || raw === "") return { kind: "missing", value: null };
    var status = String(raw);
    if (definition.status.pendingValues.indexOf(status) !== -1) return { kind: "pending", value: status };
    if (definition.status.successValues.indexOf(status) !== -1) return { kind: "success", value: status };
    if (definition.status.failureValues.indexOf(status) !== -1) return { kind: "failure", value: status };
    if (definition.status.canceledValues.indexOf(status) !== -1) return { kind: "canceled", value: status };
    return { kind: "unknown", value: status };
  }

  function appendValue(target, type, value) {
    if (typeof value !== "string" || !value) return;
    if (type === "url" || /^https?:\/\//i.test(value)) target.urls.push(value);
    else target.base64.push(value);
  }

  function collectResult(value, target, configuredType) {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string") { appendValue(target, configuredType, value); return; }
    if (Array.isArray(value)) { value.forEach(function collect(item) { collectResult(item, target, configuredType); }); return; }
    if (typeof value !== "object") return;
    if (typeof value.url === "string") appendValue(target, "url", value.url);
    if (typeof value.b64_json === "string") appendValue(target, "base64", value.b64_json);
    if (typeof value.base64 === "string") appendValue(target, "base64", value.base64);
    if (typeof value.dataUrl === "string") appendValue(target, "base64", value.dataUrl);
    if (Array.isArray(value.urls)) collectResult(value.urls, target, "url");
  }

  function normalizeAsyncResult(value, response, definition) {
    var extracted = typeof definition.result.extractor === "function"
      ? definition.result.extractor(value, response)
      : value;
    if (extracted && typeof extracted === "object" && !Array.isArray(extracted) &&
        (Array.isArray(extracted.urls) || Array.isArray(extracted.base64))) {
      return { urls: (extracted.urls || []).slice(), base64: (extracted.base64 || []).slice(), raw: extracted.raw === undefined ? value : extracted.raw };
    }
    var result = { urls: [], base64: [], raw: extracted };
    collectResult(extracted, result, definition.result.type || "auto");
    return result;
  }

  function extractAsyncResult(definition, response) {
    var value = resolveAsyncPath(response, definition.result.path);
    return normalizeAsyncResult(value, response, definition);
  }

  function safeAsyncError(definition, response) {
    var value = resolveAsyncPath(response, definition.error.path);
    if (typeof definition.error.extractor === "function") value = definition.error.extractor(value, response);
    if (value === undefined || value === null || value === "") return "Remote async task failed.";
    function redact(text) {
      return String(text || "")
        .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|token)["']?\s*:\s*)["'][^"']+["']/gi, "$1\"[REDACTED]\"")
        .slice(0, 500);
    }
    if (typeof value === "string") return redact(value);
    if (value && typeof value.message === "string") return redact(value.message);
    try { return redact(JSON.stringify(value)); }
    catch (error) { return "Remote async task returned an unreadable error."; }
  }

  function taskTemplate(value, taskId) {
    return String(value || "")
      .replace(/\{\{taskId\}\}|\{taskId\}|\{task_id\}/g, encodeURIComponent(String(taskId || "")));
  }

  function joinEndpoint(baseUrl, endpoint) {
    if (/^https?:\/\//i.test(String(endpoint || ""))) return String(endpoint);
    return builders.joinUrl(baseUrl, endpoint);
  }

  function addQuery(url, query) {
    var pairs = [];
    Object.keys(query || {}).forEach(function pair(name) {
      if (query[name] === undefined || query[name] === null) return;
      pairs.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(query[name])));
    });
    if (!pairs.length) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + pairs.join("&");
  }

  function createConfigAsyncTaskDefinition(config) {
    var source = config || {};
    return normalizeAsyncTaskDefinition({
      id: String(source.id || "custom") + "-async-v1",
      protocolId: "custom-async",
      submit: { method: source.httpMethod || "POST", endpoint: source.endpointPath, requestTimeoutMs: source.submitRequestTimeoutMs || 25000 },
      task: { idPath: source.responsePath || "id" },
      poll: {
        method: source.pollingMethod || "GET", endpointTemplate: source.pollingEndpoint,
        intervalMs: source.pollingIntervalMs, timeoutMs: source.pollingTimeoutMs,
        requestTimeoutMs: source.pollingRequestTimeoutMs
      },
      status: {
        path: source.pollingStatusPath || "status",
        pendingValues: source.pendingValues,
        successValues: source.successValues,
        failureValues: source.failureValues,
        canceledValues: source.canceledValues
      },
      result: { path: source.pollingResultPath || "output", type: source.asyncResultType || "auto", mimeType: source.resultMimeType || "image/png" },
      error: { path: source.pollingErrorPath || "error" }
    });
  }

  return {
    ASYNC_TASK_SCHEMA_VERSION: SCHEMA_VERSION,
    normalizeAsyncTaskDefinition: normalizeAsyncTaskDefinition,
    validateAsyncTaskDefinition: validateAsyncTaskDefinition,
    createConfigAsyncTaskDefinition: createConfigAsyncTaskDefinition,
    resolveAsyncPath: resolveAsyncPath,
    classifyAsyncStatus: statusKind,
    extractAsyncResult: extractAsyncResult,
    normalizeAsyncResult: normalizeAsyncResult,
    extractAsyncErrorMessage: safeAsyncError,
    applyAsyncTaskTemplate: taskTemplate,
    resolveAsyncEndpoint: joinEndpoint,
    appendAsyncQuery: addQuery
  };
}));
