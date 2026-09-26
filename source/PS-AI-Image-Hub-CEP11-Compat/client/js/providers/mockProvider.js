(function defineMockProvider(root, factory) {
  "use strict";
  var base = typeof module === "object" && module.exports
    ? require("./baseProvider")
    : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(base, errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createMockProvider(base, errors) {
  "use strict";
  var BaseProvider = base.BaseProvider;
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function delay(milliseconds) {
    return new Promise(function resolveLater(resolve) { setTimeout(resolve, milliseconds); });
  }

  class MockProvider extends BaseProvider {
    constructor(options) {
      super({
        id: "mock",
        displayName: "Mock",
        type: "mock",
        models: [{ id: "mock-image-v1", displayName: "Mock Image Model" }],
        capabilities: { supportsTextToImage: true, supportsAspectRatio: true }
      });
      this.submitDelay = options && Number.isFinite(options.submitDelay) ? options.submitDelay : 350;
      this.generationDelay = options && Number.isFinite(options.generationDelay) ? options.generationDelay : 900;
    }

    validateConfig() { return { valid: true, errors: [] }; }

    testConnection() {
      return delay(this.submitDelay).then(() => ({ ok: true, providerId: this.id }));
    }

    async generate(request, context) {
      if (!request || !request.prompt) {
        throw new AppError(ErrorCodes.PROMPT_REQUIRED, "Mock request requires a prompt.");
      }
      await delay(this.submitDelay);
      if (context && typeof context.onStatus === "function") context.onStatus("generating");
      await delay(this.generationDelay);
      return {
        providerId: this.id,
        modelId: request.modelId,
        status: "completed",
        images: [{
          id: "mock-" + Date.now(),
          mimeType: "image/png",
          sourceType: "plugin-asset",
          previewSource: "assets/mock-result.png",
          importSource: {
            type: "plugin-asset",
            relativePath: "client/assets/mock-result.png"
          },
          width: 96,
          height: 96,
          prompt: request.prompt
        }]
      };
    }

    parseResponse(response) {
      if (!response || response.status !== "completed" || !Array.isArray(response.images)) {
        throw new AppError(ErrorCodes.UNKNOWN_RESPONSE, "Mock response has an unexpected shape.");
      }
      return response;
    }

    extractImages(parsedResponse) { return parsedResponse.images.slice(); }
  }

  return { MockProvider: MockProvider };
}));
