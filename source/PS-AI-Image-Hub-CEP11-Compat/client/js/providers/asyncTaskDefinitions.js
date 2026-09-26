(function defineAsyncTaskDefinitions(root, factory) {
  "use strict";
  var definitions = typeof module === "object" && module.exports ? require("./asyncTaskDefinition") : root.PSAIImageHubCompat;
  var api = factory(definitions);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAsyncTaskDefinitions(definitions) {
  "use strict";

  function bearerHeaders(context, includeJson) {
    var headers = { Authorization: "Bearer " + context.apiKey };
    if (includeJson) headers["Content-Type"] = "application/json";
    return headers;
  }

  function createGrsNewAsyncDefinition() {
    return definitions.normalizeAsyncTaskDefinition({
      id: "grs-new-image-v1",
      protocolId: "new-api",
      definitionVersion: 1,
      submit: {
        method: "POST", endpoint: "/v1/api/generate", requestTimeoutMs: 25000,
        headersBuilder: function headers(context) { return bearerHeaders(context, true); },
        bodyBuilder: function body(context) { return context.requestBody || context.request; }
      },
      task: { idPath: "id" },
      poll: {
        method: "GET", endpoint: "/v1/api/result", requestTimeoutMs: 25000,
        intervalMs: 3000, timeoutMs: 600000, maxAttempts: 201,
        queryBuilder: function query(context) { return { id: context.task.id }; },
        headersBuilder: function headers(context) { return bearerHeaders(context, false); }
      },
      status: {
        path: "status", pendingValues: ["running"], successValues: ["succeeded"],
        failureValues: ["failed", "violation"], canceledValues: ["cancelled"]
      },
      result: {
        path: "results",
        extractor: function extract(results) {
          return { urls: (results || []).map(function url(item) { return item && item.url; }).filter(Boolean), base64: [], raw: results };
        }
      },
      error: { path: "error" },
      cancel: { supported: false }
    });
  }

  function createReplicatePredictionsDefinition() {
    return definitions.normalizeAsyncTaskDefinition({
      id: "replicate-predictions-v1",
      protocolId: "replicate-predictions",
      definitionVersion: 1,
      submit: {
        method: "POST", endpoint: "/v1/predictions", requestTimeoutMs: 25000,
        headersBuilder: function headers(context) { return bearerHeaders(context, true); },
        bodyBuilder: function body(context) {
          return { version: context.request.modelId, input: { prompt: context.request.prompt } };
        }
      },
      task: { idPath: "id" },
      poll: {
        method: "GET", endpointPath: "urls.get", requestTimeoutMs: 25000,
        intervalMs: 1000, timeoutMs: 600000, maxAttempts: 601,
        headersBuilder: function headers(context) { return bearerHeaders(context, false); }
      },
      status: {
        path: "status", pendingValues: ["starting", "processing"], successValues: ["succeeded"],
        failureValues: ["failed"], canceledValues: ["canceled"]
      },
      result: { path: "output", type: "auto", mimeType: "image/png" },
      error: { path: "error" },
      cancel: {
        supported: true, method: "POST", endpointPath: "urls.cancel", requestTimeoutMs: 25000,
        headersBuilder: function headers(context) { return bearerHeaders(context, false); }
      }
    });
  }

  return {
    createGrsNewAsyncDefinition: createGrsNewAsyncDefinition,
    createReplicatePredictionsDefinition: createReplicatePredictionsDefinition
  };
}));
