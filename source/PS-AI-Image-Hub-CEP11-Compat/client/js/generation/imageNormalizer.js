(function defineImageNormalizer(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImageNormalizer(errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var SOURCE_TYPES = Object.freeze([
    "plugin-asset", "local-file", "url", "base64", "data-url", "blob", "bytes"
  ]);

  function normalizeImportSource(image) {
    var source = image.importSource;
    if (!source && image.localFilePath) source = { type: "local-file", path: image.localFilePath };
    if (!source || typeof source !== "object" || SOURCE_TYPES.indexOf(source.type) === -1) {
      throw new AppError(ErrorCodes.IMPORT_SOURCE_MISSING, "Generated image import source is missing or unsupported.");
    }
    return Object.assign({}, source);
  }

  class ImageNormalizer {
    normalizeAll(images) {
      if (!Array.isArray(images) || images.length === 0) {
        throw new AppError(ErrorCodes.NO_IMAGES, "No generated images were supplied for normalization.");
      }
      return Promise.resolve(images.map((image) => this.normalize(image)));
    }

    normalize(image) {
      if (!image || typeof image !== "object") {
        throw new AppError(ErrorCodes.UNKNOWN_RESPONSE, "Generated image metadata is missing.");
      }
      var previewSource = image.previewSource || image.previewUrl || image.url || image.dataUrl || null;
      if (!previewSource) {
        throw new AppError(ErrorCodes.UNKNOWN_RESPONSE, "Generated image preview source is missing.");
      }
      var importSource = normalizeImportSource(image);
      return {
        id: image.id || "generated-" + Date.now(),
        mimeType: String(image.mimeType || "image/png").toLowerCase(),
        sourceType: image.sourceType || importSource.type,
        previewSource: previewSource,
        previewUrl: previewSource,
        importSource: importSource,
        localFilePath: importSource.type === "local-file" ? importSource.path : null,
        width: image.width || null,
        height: image.height || null,
        prompt: image.prompt || "",
        rawResponseMeta: image.rawResponseMeta || null
      };
    }
  }

  return { ImageNormalizer: ImageNormalizer, GENERATED_IMAGE_SOURCE_TYPES: SOURCE_TYPES };
}));
