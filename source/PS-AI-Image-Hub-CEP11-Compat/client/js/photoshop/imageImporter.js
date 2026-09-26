(function defineImageImporter(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(errors, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImageImporter(errors, logging) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value); return isFinite(number) ? number : null;
  }

  function targetBoundsFromFit(fit, target) {
    var source = fit || {}, fallback = target && target.bounds || target || {};
    var left = finite(source.targetLeft); if (left === null) left = finite(fallback.left); if (left === null) left = 0;
    var top = finite(source.targetTop); if (top === null) top = finite(fallback.top); if (top === null) top = 0;
    var width = finite(source.targetWidth); if (!(width > 0)) width = finite(fallback.width);
    var height = finite(source.targetHeight); if (!(height > 0)) height = finite(fallback.height);
    if (!(width > 0 && height > 0)) return null;
    return { left: left, top: top, right: left + width, bottom: top + height, width: width, height: height };
  }

  function buildImportContext(settings, sizedCopy, item, target) {
    var fit = sizedCopy && sizedCopy.fit || {};
    var bounds = targetBoundsFromFit(fit, target);
    var documentBounds = fit.documentBounds || target && target.documentBounds || null;
    var pathType = sizedCopy && sizedCopy.importPathType
      ? String(sizedCopy.importPathType) : sizedCopy && sizedCopy.transient ? "matched" : "original";
    var originalWidth = finite(fit.sourceWidth); if (!(originalWidth > 0)) originalWidth = finite(item && item.sourceWidth);
    var originalHeight = finite(fit.sourceHeight); if (!(originalHeight > 0)) originalHeight = finite(item && item.sourceHeight);
    var calculatedScale = finite(fit.calculatedScale); if (calculatedScale === null) calculatedScale = 1;
    var hostAppliedScale = finite(item && item.appliedScale);
    var appliedScale = pathType === "smart-object-upscale" && hostAppliedScale > 0
      ? hostAppliedScale : finite(fit.appliedScale);
    if (appliedScale === null) appliedScale = finite(fit.scale); if (appliedScale === null) appliedScale = 1;
    var context = {
      importSizingEnabled: settings.matchMainSize === true,
      importPathType: pathType,
      targetBounds: bounds,
      targetWidth: bounds && bounds.width || null,
      targetHeight: bounds && bounds.height || null,
      originalWidth: originalWidth,
      originalHeight: originalHeight,
      calculatedScale: calculatedScale,
      appliedScale: appliedScale,
      resizeApplied: Boolean(fit.resizeApplied),
      upscalePrevented: Boolean(fit.upscalePrevented),
      alignmentAnchor: "center",
      fitMode: "fit",
      documentWidth: finite(item && item.documentWidth) || finite(documentBounds && documentBounds.width),
      documentHeight: finite(item && item.documentHeight) || finite(documentBounds && documentBounds.height),
      documentName: String(item && item.documentName || ""),
      mainSourceType: String(fit.sourceType || target && target.sourceType || ""),
      usedSmartObjectUpscale: Boolean(item && item.usedSmartObjectUpscale || sizedCopy && sizedCopy.useSmartObjectUpscale),
      historyReimportUsedSavedContext: settings.historyReimportUsedSavedContext === true,
      currentDocumentMatchesSavedImportContext: typeof settings.currentDocumentMatchesSavedImportContext === "boolean"
        ? settings.currentDocumentMatchesSavedImportContext : null,
      finalBounds: item && item.finalBounds || null
    };
    return context;
  }

  class ImageImporter {
    constructor(options) {
      this.photoshopBridge = options && options.photoshopBridge || null;
      this.imageFileStore = options && options.imageFileStore || null;
      this.importSizingManager = options && options.importSizingManager || null;
      this.supportsProgressCallbacks = true;
    }

    requireBridge() {
      if (!this.photoshopBridge || !this.photoshopBridge.isAvailable()) {
        throw new AppError(ErrorCodes.BRIDGE_UNAVAILABLE, "CEP Photoshop Bridge is unavailable.");
      }
      return this.photoshopBridge;
    }

    resolveLocalFilePath(image) {
      if (!image || !image.importSource) {
        throw new AppError(ErrorCodes.IMPORT_SOURCE_MISSING, "Generated image has no import source.");
      }
      if (image.importSource.type === "plugin-asset") {
        return this.requireBridge().resolveExtensionAsset(image.importSource.relativePath);
      }
      if (image.importSource.type === "local-file" && image.importSource.path) {
        return String(image.importSource.path);
      }
      throw new AppError(
        ErrorCodes.UNSUPPORTED_IMAGE_SOURCE,
        "Generated image source type is not importable in the current CEP phase: " + image.importSource.type
      );
    }

    async importImages(images, options) {
      if (!Array.isArray(images) || images.length === 0) {
        throw new AppError(ErrorCodes.MISSING_GENERATED_RESULT, "No generated images are available for import.");
      }
      var bridge = this.requireBridge();
      var settings = options || {};
      var items = [];
      var importContexts = [];
      for (var index = 0; index < images.length; index += 1) {
        var localFilePath;
        var materialized = null;
        var sizedCopy = null;
        try {
          if (images[index].importSource && ["url", "base64", "data-url", "bytes"].indexOf(images[index].importSource.type) !== -1) {
            if (!this.imageFileStore) throw new AppError(ErrorCodes.UNSUPPORTED_IMAGE_SOURCE, "Image file materializer is unavailable.");
            if (settings.onStatus) settings.onStatus("downloading", { imageIndex: index });
            var downloadStartedAt = Date.now();
            materialized = await this.imageFileStore.materialize(images[index].importSource, { cancellationToken: settings.cancellationToken });
            if (settings.onDiagnostic) settings.onDiagnostic("RESULT_DOWNLOAD_DONE", { imageIndex: index, downloadMs: Date.now() - downloadStartedAt });
            localFilePath = materialized.path;
          } else {
            localFilePath = this.resolveLocalFilePath(images[index]);
          }
          var importTarget = settings.mainTarget || settings.mainDimensions;
          if (settings.matchMainSize && importTarget && this.importSizingManager) {
            sizedCopy = await this.importSizingManager.prepareLocalImage(localFilePath, importTarget);
            if (sizedCopy && sizedCopy.path) localFilePath = sizedCopy.path;
          }
          if (settings.cancellationToken && settings.cancellationToken.cancelled) throw new AppError(ErrorCodes.CANCELLED, "Import was cancelled.");
          if (settings.onStatus) settings.onStatus("importing", { imageIndex: index });
          var item;
          if (sizedCopy && sizedCopy.requiresPhotoshopPlacement) {
            if (typeof bridge.importSmartObjectToBounds !== "function") {
              throw new AppError(ErrorCodes.SMART_OBJECT_IMPORT_FAILED, "Photoshop Smart Object placement is unavailable.");
            }
            var placementBounds = targetBoundsFromFit(sizedCopy.fit, importTarget);
            if (!placementBounds) throw new AppError(ErrorCodes.SMART_OBJECT_IMPORT_FAILED, "Smart Object placement target is invalid.");
            item = await bridge.importSmartObjectToBounds(localFilePath, placementBounds);
          } else item = await bridge.importImage(localFilePath);
          if (!item || item.imported !== true || !item.layerName) {
            throw new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "Photoshop did not confirm the imported layer.");
          }
          items.push(item);
          var importContext = buildImportContext(settings, sizedCopy, item, importTarget);
          importContexts.push(importContext);
          logging.logger.info("IMPORT_STRATEGY_SELECTED", importContext);
          if (settings.onDiagnostic) settings.onDiagnostic("IMPORT_CONTEXT_READY", importContext);
        } finally {
          if (sizedCopy && sizedCopy.transient) this.importSizingManager.remove(sizedCopy.path);
          if (materialized && materialized.transient) this.imageFileStore.remove(materialized.path);
        }
      }
      return {
        imported: true,
        imageCount: items.length,
        layerNames: items.map(function layerName(item) { return item.layerName; }),
        documentName: items[items.length - 1].documentName || null,
        items: items,
        importContext: importContexts[0] || null,
        importContexts: importContexts
      };
    }
  }

  return { ImageImporter: ImageImporter, buildImportContext: buildImportContext, importTargetBoundsFromFit: targetBoundsFromFit };
}));
