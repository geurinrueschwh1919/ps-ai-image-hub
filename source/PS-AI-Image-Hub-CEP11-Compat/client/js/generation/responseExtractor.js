(function defineResponseExtractor(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var normalizer = typeof module === "object" && module.exports
    ? require("./imageNormalizer")
    : root.PSAIImageHubCompat;
  var api = factory(errors, normalizer);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createResponseExtractor(errors, normalizer) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  class ResponseExtractor {
    constructor(options) {
      this.imageNormalizer = options && options.imageNormalizer || new normalizer.ImageNormalizer();
    }

    extract(provider, rawResponse) {
      var parsed = provider.parseResponse(rawResponse);
      var images = provider.extractImages(parsed);
      if (!Array.isArray(images) || images.length === 0) {
        throw new AppError(ErrorCodes.NO_IMAGES, "Provider response contains no images.");
      }
      return this.imageNormalizer.normalizeAll(images).then(function normalized(normalizedImages) {
        return { parsed: parsed, images: normalizedImages };
      });
    }
  }

  return { ResponseExtractor: ResponseExtractor };
}));
