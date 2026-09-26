(function defineImportSizingManager(root, factory) {
  "use strict";
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(root, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImportSizingManager(root, logging) {
  "use strict";

  function calculateFit(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    var sw = Number(sourceWidth), sh = Number(sourceHeight), tw = Number(targetWidth), th = Number(targetHeight);
    if (!(sw > 0 && sh > 0 && tw > 0 && th > 0)) return null;
    var calculatedScale = Math.min(tw / sw, th / sh);
    var appliedScale = Math.min(calculatedScale, 1);
    var width = Math.max(1, Math.round(sw * appliedScale)), height = Math.max(1, Math.round(sh * appliedScale));
    return { sourceWidth: sw, sourceHeight: sh, canvasWidth: Math.round(tw), canvasHeight: Math.round(th), width: width, height: height,
      x: Math.floor((tw - width) / 2), y: Math.floor((th - height) / 2), scale: appliedScale,
      calculatedScale: calculatedScale, appliedScale: appliedScale, resizeApplied: appliedScale < 1,
      upscalePrevented: calculatedScale > 1,
      sameRatio: Math.abs(sw / sh - tw / th) < 0.001, mode: "fit", crop: false, stretch: false };
  }

  function normalizeBounds(value) {
    if (!value) return null;
    var left = Number(value.left), top = Number(value.top), width = Number(value.width), height = Number(value.height);
    if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) return null;
    return { left: left, top: top, right: isFinite(Number(value.right)) ? Number(value.right) : left + width,
      bottom: isFinite(Number(value.bottom)) ? Number(value.bottom) : top + height, width: width, height: height };
  }

  function calculateImportTransform(sourceWidth, sourceHeight, target) {
    var value = target || {};
    var bounds = normalizeBounds(value.bounds) || normalizeBounds({ left: 0, top: 0, width: value.width, height: value.height });
    if (!bounds) return null;
    var documentBounds = normalizeBounds(value.documentBounds) || normalizeBounds({ left: 0, top: 0, width: bounds.right, height: bounds.bottom }) || bounds;
    var fit = calculateFit(sourceWidth, sourceHeight, bounds.width, bounds.height);
    if (!fit) return null;
    var finalLeft = bounds.left + fit.x, finalTop = bounds.top + fit.y;
    return Object.assign({}, fit, {
      sourceWidth: Number(sourceWidth), sourceHeight: Number(sourceHeight), targetLeft: bounds.left, targetTop: bounds.top,
      targetWidth: bounds.width, targetHeight: bounds.height, finalLeft: finalLeft, finalTop: finalTop,
      finalRight: finalLeft + fit.width, finalBottom: finalTop + fit.height,
      drawX: finalLeft - documentBounds.left, drawY: finalTop - documentBounds.top,
      canvasWidth: Math.round(documentBounds.width), canvasHeight: Math.round(documentBounds.height),
      documentBounds: documentBounds, sourceType: String(value.sourceType || "local-image")
    });
  }

  function fileUrl(path) {
    var value = String(path || "").replace(/\\/g, "/");
    return (/^[A-Za-z]:\//.test(value) ? "file:///" : "file://") + encodeURI(value).replace(/#/g, "%23");
  }

  function browserCodec(runtime) {
    return {
      prepare(sourcePath, target, outputPath, writeBase64) {
        return new Promise(function prepare(resolve, reject) {
          if (typeof runtime.Image !== "function" || !runtime.document) { reject(new Error("CEP image sizing is unavailable.")); return; }
          var image = new runtime.Image();
          image.onload = function loaded() {
            try {
              var fit = calculateImportTransform(image.naturalWidth || image.width, image.naturalHeight || image.height, target);
              if (!fit) throw new Error("Invalid import sizing dimensions.");
              if (!fit.resizeApplied) { resolve(fit); return; }
              var canvas = runtime.document.createElement("canvas"); canvas.width = fit.canvasWidth; canvas.height = fit.canvasHeight;
              var context = canvas.getContext("2d"); if (!context) throw new Error("CEP Canvas 2D context is unavailable.");
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.drawImage(image, fit.drawX, fit.drawY, fit.width, fit.height);
              var match = canvas.toDataURL("image/png").match(/^data:image\/png;base64,([\s\S]+)$/i);
              if (!match) throw new Error("CEP Canvas returned invalid PNG data.");
              writeBase64(outputPath, match[1]); resolve(fit);
            } catch (error) { reject(error); }
          };
          image.onerror = function failed() { reject(new Error("Generated image could not be decoded for import sizing.")); };
          image.src = fileUrl(sourcePath);
        });
      }
    };
  }

  class ImportSizingManager {
    constructor(options) {
      var settings = options || {};
      this.photoshopBridge = settings.photoshopBridge;
      this.cepFs = settings.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = settings.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
      this.codec = settings.codec || browserCodec(settings.runtimeRoot || root);
      this.now = settings.now || function now() { return Date.now(); };
    }
    ensureDirectory() {
      var userRoot = this.photoshopBridge.getUserDataRoot(), slash = userRoot.indexOf("\\") !== -1 || /^[A-Za-z]:/.test(userRoot) ? "\\" : "/";
      var rootPath = userRoot + slash + "PSAIImageHubCompat", folder = rootPath + slash + "temp-import";
      [rootPath, folder].forEach((path) => { var result = this.cepFs.makedir(path); if (result && result.err !== 0 && (!this.cepFs.stat || this.cepFs.stat(path).err !== 0)) throw new Error("Could not create import sizing directory."); });
      return { folder: folder, slash: slash };
    }
    async resolveTarget(mainTarget) {
      if (!mainTarget || !(Number(mainTarget.width) > 0 && Number(mainTarget.height) > 0)) return null;
      var target = Object.assign({}, mainTarget), bounds = normalizeBounds(target.bounds), documentBounds = normalizeBounds(target.documentBounds);
      if (!documentBounds && this.photoshopBridge && typeof this.photoshopBridge.getDocumentMetadata === "function") {
        try {
          var metadata = await this.photoshopBridge.getDocumentMetadata();
          documentBounds = normalizeBounds({ left: 0, top: 0, width: metadata.width, height: metadata.height });
        } catch (error) { documentBounds = null; }
      }
      if (!bounds) {
        if (documentBounds) {
          bounds = normalizeBounds({ left: documentBounds.left + (documentBounds.width - Number(target.width)) / 2,
            top: documentBounds.top + (documentBounds.height - Number(target.height)) / 2,
            width: Number(target.width), height: Number(target.height) });
        } else bounds = normalizeBounds({ left: 0, top: 0, width: target.width, height: target.height });
      }
      if (!documentBounds) documentBounds = normalizeBounds({ left: 0, top: 0, width: Math.max(bounds.right, bounds.width), height: Math.max(bounds.bottom, bounds.height) });
      target.bounds = bounds; target.documentBounds = documentBounds; target.width = bounds.width; target.height = bounds.height;
      target.sourceType = String(target.sourceType || "local-image");
      return target;
    }
    async prepareLocalImage(sourcePath, mainTarget) {
      var target = await this.resolveTarget(mainTarget);
      if (!target) return null;
      var location = this.ensureDirectory();
      var outputPath = location.folder + location.slash + "matched-" + this.now() + "-" + Math.floor(Math.random() * 100000) + ".png";
      logging.logger.info("IMPORT_TARGET_BOUNDS", { sourceType: target.sourceType, left: target.bounds.left, top: target.bounds.top,
        width: target.bounds.width, height: target.bounds.height });
      var fit = await this.codec.prepare(sourcePath, target, outputPath,
        (path, data) => { var result = this.cepFs.writeFile(path, data, this.base64Encoding); if (!result || result.err !== 0) throw new Error("Could not write import-sized PNG."); });
      var appliedScale = isFinite(Number(fit.appliedScale)) ? Number(fit.appliedScale) : Number(fit.scale);
      var calculatedScale = isFinite(Number(fit.calculatedScale)) ? Number(fit.calculatedScale) : appliedScale;
      var sourceWidth = Number(fit.sourceWidth) || fit.width / appliedScale, sourceHeight = Number(fit.sourceHeight) || fit.height / appliedScale;
      var resizeApplied = fit.resizeApplied === true || appliedScale < 1;
      var upscalePrevented = fit.upscalePrevented === true || calculatedScale > 1;
      var importPathType = resizeApplied ? "matched" : upscalePrevented ? "smart-object-upscale" : "original";
      var usedSmartObjectUpscale = importPathType === "smart-object-upscale";
      var diagnostics = { originalWidth: sourceWidth, originalHeight: sourceHeight,
        targetWidth: Number(fit.targetWidth) || target.bounds.width, targetHeight: Number(fit.targetHeight) || target.bounds.height,
        calculatedScale: calculatedScale, appliedScale: appliedScale, resizeApplied: resizeApplied, upscalePrevented: upscalePrevented,
        importPathType: importPathType, usedSmartObjectUpscale: usedSmartObjectUpscale };
      logging.logger.info("IMPORT_RESULT_TRANSFORM", Object.assign({}, diagnostics, {
        scale: appliedScale, finalLeft: isFinite(Number(fit.finalLeft)) ? Number(fit.finalLeft) : target.bounds.left + fit.x,
        finalTop: isFinite(Number(fit.finalTop)) ? Number(fit.finalTop) : target.bounds.top + fit.y }));
      logging.logger.info("RESULT_MATCH_MAIN_SIZE", Object.assign({}, diagnostics, {
        sourceDimensions: { width: sourceWidth, height: sourceHeight },
        sentDimensions: resizeApplied ? { width: fit.canvasWidth, height: fit.canvasHeight } : { width: sourceWidth, height: sourceHeight },
        fitMode: "fit", crop: false, stretch: false }));
      if (!resizeApplied) {
        return { path: sourcePath, transient: false, fit: fit, original: true, importPathType: importPathType,
          useSmartObjectUpscale: usedSmartObjectUpscale,
          requiresPhotoshopPlacement: usedSmartObjectUpscale || Number(fit.finalLeft) !== 0 || Number(fit.finalTop) !== 0 };
      }
      return { path: outputPath, transient: true, fit: fit, original: false, importPathType: "matched",
        useSmartObjectUpscale: false, requiresPhotoshopPlacement: false };
    }
    remove(path) { if (path && this.cepFs && this.cepFs.deleteFile) try { this.cepFs.deleteFile(path); } catch (error) { /* best effort */ } }
  }

  return { ImportSizingManager: ImportSizingManager, calculateFitDimensions: calculateFit,
    calculateImportTransform: calculateImportTransform, normalizeImportBounds: normalizeBounds, importSizingFileUrl: fileUrl };
}));
