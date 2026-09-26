(function defineAliyunBailianDefinition(root, factory) {
  "use strict";
  var definitions = typeof module === "object" && module.exports ? require("./asyncTaskDefinition") : root.PSAIImageHubCompat;
  var requestBuilder = typeof module === "object" && module.exports ? require("./aliyunBailianRequestBuilder") : root.PSAIImageHubCompat;
  var api = factory(definitions, requestBuilder);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAliyunBailianDefinitionModule(definitions, requestBuilder) {
  "use strict";

  function bearerHeaders(context, includeJson) {
    var headers = { Authorization: "Bearer " + context.apiKey };
    if (includeJson) {
      headers["Content-Type"] = "application/json";
      headers["X-DashScope-Async"] = "enable";
    }
    return headers;
  }

  function extractImages(choices) {
    var urls = [];
    (Array.isArray(choices) ? choices : []).forEach(function choice(choice) {
      var content = choice && choice.message && choice.message.content;
      (Array.isArray(content) ? content : []).forEach(function item(item) {
        if (item && typeof item.image === "string" && item.image) urls.push(item.image);
      });
    });
    return { urls: urls, base64: [], raw: choices };
  }

  function extractError(unused, response) {
    var source = response || {};
    var output = source.output || {};
    var code = source.code || output.code || "";
    var message = source.message || output.message || "";
    if (code && message) return String(code) + ": " + String(message);
    return String(message || code || "Remote Bailian task failed.");
  }

  function createDefinition() {
    return definitions.normalizeAsyncTaskDefinition({
      id: "aliyun-bailian-qwen-image-3-v1",
      protocolId: "dashscope-qwen-image-async",
      definitionVersion: 1,
      submit: {
        method: "POST",
        endpoint: "/api/v1/services/aigc/image-generation/generation",
        requestTimeoutMs: 25000,
        headersBuilder: function headers(context) { return bearerHeaders(context, true); },
        bodyBuilder: function body(context) { return requestBuilder.buildAliyunBailianRequestBody(context.request); }
      },
      task: { idPath: "output.task_id" },
      poll: {
        method: "GET",
        endpointTemplate: "/api/v1/tasks/{taskId}",
        requestTimeoutMs: 25000,
        intervalMs: 3000,
        timeoutMs: 600000,
        maxAttempts: 201,
        unknownStatusLimit: 1,
        headersBuilder: function headers(context) { return bearerHeaders(context, false); }
      },
      status: {
        path: "output.task_status",
        pendingValues: ["PENDING", "RUNNING"],
        successValues: ["SUCCEEDED"],
        failureValues: ["FAILED"],
        canceledValues: ["CANCELED"]
      },
      result: {
        path: "output.choices",
        type: "url",
        mimeType: "image/png",
        extractor: extractImages
      },
      error: { path: "message", extractor: extractError },
      cancel: { supported: false }
    });
  }

  return {
    createAliyunBailianAsyncDefinition: createDefinition,
    extractAliyunBailianImages: extractImages,
    extractAliyunBailianError: extractError
  };
}));
