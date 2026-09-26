(function defineReferenceImageManager(root, factory) {
  "use strict";
  var base64 = typeof module === "object" && module.exports ? require("../utils/base64") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(base64, errors, logging, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createReferenceImageManager(base64, errors, logging, root) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function readUint32(bytes, offset) {
    return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
  }

  function imageDimensions(bytes, mimeType) {
    if (mimeType === "image/png" && bytes.length >= 24) return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
    if (mimeType === "image/jpeg") {
      var offset = 2;
      while (offset + 8 < bytes.length) {
        if (bytes[offset] !== 0xFF) { offset += 1; continue; }
        var marker = bytes[offset + 1];
        var length = (bytes[offset + 2] << 8) + bytes[offset + 3];
        if (length < 2) break;
        if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB)) {
          return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
        }
        offset += length + 2;
      }
    }
    return { width: null, height: null };
  }

  function fileNameFromPath(path) {
    var parts = String(path || "").split(/[\\/]/);
    return parts[parts.length - 1] || "image";
  }

  function normalizeBounds(value) {
    if (!value) return null;
    var left = Number(value.left), top = Number(value.top);
    var width = Number(value.width), height = Number(value.height);
    if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) return null;
    return { left: left, top: top, right: isFinite(Number(value.right)) ? Number(value.right) : left + width,
      bottom: isFinite(Number(value.bottom)) ? Number(value.bottom) : top + height, width: width, height: height };
  }

  class ReferenceImageManager {
    constructor(options) {
      this.photoshopBridge = options.photoshopBridge;
      this.cepFs = options.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = options.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
    }

    ensureReferenceDirectory() {
      var userRoot = this.photoshopBridge.getUserDataRoot();
      var slash = userRoot.indexOf("\\") !== -1 || /^[A-Za-z]:/.test(userRoot) ? "\\" : "/";
      var folder = userRoot + slash + "PSAIImageHubCompat";
      var result = this.cepFs.makedir(folder);
      if (result && result.err !== 0 && (!this.cepFs.stat || this.cepFs.stat(folder).err !== 0)) {
        throw new AppError(ErrorCodes.REFERENCE_EXPORT_FAILED, "Could not create the reference image directory.");
      }
      return { folder: folder, slash: slash };
    }

    readReference(path, metadata) {
      var info = metadata || {};
      if (!this.cepFs || typeof this.cepFs.readFile !== "function") throw new AppError(ErrorCodes.REFERENCE_FILE_READ_FAILED, "CEP file reader is unavailable.", { stage: "referenceRead", provider: "Image Input", endpoint: "CEP FS" });
      var readStartedAt = Date.now();
      var result = this.cepFs.readFile(path, this.base64Encoding);
      var readMs = Date.now() - readStartedAt;
      if (!result || result.err !== 0 || !result.data) throw new AppError(ErrorCodes.REFERENCE_FILE_READ_FAILED, "Reference image could not be read.", { stage: "referenceRead", provider: "Image Input", endpoint: "CEP FS" });
      var bytesRead;
      try { bytesRead = base64.base64DecodedByteLength(result.data); }
      catch (error) { throw new AppError(ErrorCodes.REFERENCE_BASE64_ENCODE_FAILED, "Reference image Base64 length is invalid.", { stage: "referenceEncode", provider: "Image Input", endpoint: "CEP FS" }); }
      logging.logImagePipeline(1, "REFERENCE_EXPORT_DONE", { sourceType: info.sourceType || "local-file", width: info.width, height: info.height, fileSizeBytes: bytesRead });
      logging.logImagePipeline(2, "REFERENCE_READ_DONE", { sourceType: info.sourceType || "local-file", bytesRead: bytesRead });
      var decoded;
      var encodeStartedAt = Date.now();
      try { decoded = base64.base64ToBytes(result.data); }
      catch (error) { throw new AppError(ErrorCodes.REFERENCE_BASE64_ENCODE_FAILED, "Reference image Base64 encoding failed.", { stage: "referenceEncode", provider: "Image Input", endpoint: "CEP FS", bytesRead: bytesRead }); }
      logging.logImagePipeline(3, "REFERENCE_ENCODE_DONE", { sourceType: info.sourceType || "local-file", base64Length: decoded.base64.length });
      var mimeType = base64.detectImageMimeType(decoded.bytes);
      if (["image/png", "image/jpeg"].indexOf(mimeType) === -1) throw new AppError(ErrorCodes.UNSUPPORTED_IMAGE_FILE, "Reference image must be PNG or JPEG.");
      var dimensions = imageDimensions(decoded.bytes, mimeType);
      return {
        id: "image-input-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
        sourceType: info.sourceType || "local-file",
        sourceLabel: info.sourceLabel || "local-file",
        bounds: normalizeBounds(info.bounds),
        documentBounds: normalizeBounds(info.documentBounds),
        path: path,
        localPath: path,
        fileName: fileNameFromPath(path),
        width: Number(info.width || dimensions.width) || null,
        height: Number(info.height || dimensions.height) || null,
        mimeType: mimeType,
        base64: decoded.base64,
        apiValue: decoded.base64,
        previewSource: "data:" + mimeType + ";base64," + decoded.base64,
        transient: info.transient === true,
        timings: { exportMs: Number(info.exportMs) || 0, readMs: readMs, encodeMs: Date.now() - encodeStartedAt }
      };
    }

    chooseLocalImage(title) {
      if (!this.cepFs || typeof this.cepFs.showOpenDialog !== "function") throw new AppError(ErrorCodes.REFERENCE_EXPORT_FAILED, "CEP file picker is unavailable.");
      var result = this.cepFs.showOpenDialog(false, false, title || "选择图片", "", ["png", "jpg", "jpeg"]);
      if (!result || result.err !== 0 || !result.data || !result.data[0]) return null;
      return this.readReference(result.data[0], { sourceType: "local-image", sourceLabel: "local-file", transient: false });
    }

    async exportFromPhotoshop(mode) {
      var location = this.ensureReferenceDirectory();
      var filePath = location.folder + location.slash + "reference-" + mode + "-" + Date.now() + ".png";
      var exportStartedAt = Date.now();
      var documentMetadata = await this.photoshopBridge.getDocumentMetadata();
      var documentBounds = normalizeBounds({ left: 0, top: 0, width: documentMetadata.width, height: documentMetadata.height });
      var targetBounds = mode === "selection" ? normalizeBounds(await this.photoshopBridge.getSelectionBounds()) : documentBounds;
      var metadata = await this.photoshopBridge.exportReferenceImage(mode, filePath);
      var exportMs = Date.now() - exportStartedAt;
      return this.readReference(filePath, {
        sourceType: mode === "selection" ? "current-selection" : "current-canvas",
        sourceLabel: mode === "selection" ? "selection" : "canvas",
        width: metadata.width,
        height: metadata.height,
        bounds: targetBounds,
        documentBounds: documentBounds,
        transient: true,
        exportMs: exportMs
      });
    }

    getCurrentDocumentMetadata() { return this.photoshopBridge.getDocumentMetadata(); }

    remove(reference) {
      if (!reference || !reference.transient || !reference.path || !this.cepFs || typeof this.cepFs.deleteFile !== "function") return;
      try { this.cepFs.deleteFile(reference.path); } catch (error) { /* best-effort cleanup */ }
    }
  }

  return { ReferenceImageManager: ReferenceImageManager, readReferenceImageDimensions: imageDimensions, normalizeImageBounds: normalizeBounds };
}));
