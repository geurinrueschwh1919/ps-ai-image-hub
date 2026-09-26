(function defineImageFileStore(root, factory) {
  "use strict";
  var base64 = typeof module === "object" && module.exports ? require("../utils/base64") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var api = factory(base64, errors, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createImageFileStore(base64, errors, root) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  class ImageFileStore {
    constructor(options) {
      this.photoshopBridge = options.photoshopBridge;
      this.apiClient = options.apiClient;
      this.cepFs = options.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = options.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
    }

    ensureDirectory(path) {
      if (!this.cepFs || typeof this.cepFs.makedir !== "function" || typeof this.cepFs.writeFile !== "function") {
        throw new AppError(ErrorCodes.TEMP_FILE_WRITE_FAILED, "CEP file system API is unavailable.");
      }
      var result = this.cepFs.makedir(path);
      if (result && result.err === 0) return;
      if (typeof this.cepFs.stat === "function") {
        var stat = this.cepFs.stat(path);
        if (stat && stat.err === 0) return;
      }
      throw new AppError(ErrorCodes.TEMP_FILE_WRITE_FAILED, "Could not create generated image directory.", { cepError: result && result.err });
    }

    async sourceToBase64(importSource, options) {
      if (importSource.type === "base64" || importSource.type === "data-url") {
        return base64.base64ToBytes(importSource.data || importSource.dataUrl || "");
      }
      if (importSource.type === "url") {
        var downloaded;
        try { downloaded = await this.apiClient.requestArrayBuffer(importSource.url, { cancellationToken: options && options.cancellationToken, timeoutContext: "download" }); }
        catch (error) {
          if (error instanceof AppError && [ErrorCodes.IMAGE_DOWNLOAD_FAILED, ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT, ErrorCodes.CANCELLED, ErrorCodes.CORS_ERROR].indexOf(error.code) !== -1) throw error;
          throw new AppError(ErrorCodes.IMAGE_DOWNLOAD_FAILED, "Generated image URL download failed.", { causeCode: error && error.code });
        }
        return {
          bytes: new Uint8Array(downloaded.bytes),
          base64: base64.bytesToBase64(downloaded.bytes),
          mimeType: downloaded.mimeType || null
        };
      }
      if (importSource.type === "bytes") {
        return { bytes: new Uint8Array(importSource.data), base64: base64.bytesToBase64(importSource.data), mimeType: importSource.mimeType || null };
      }
      throw new AppError(ErrorCodes.UNSUPPORTED_IMAGE_SOURCE, "Image source cannot be materialized.");
    }

    async materialize(importSource, options) {
      var payload = await this.sourceToBase64(importSource, options);
      var detected = base64.detectImageMimeType(payload.bytes);
      if (!detected) throw new AppError(ErrorCodes.UNSUPPORTED_RESULT_FORMAT, "Generated result is not a recognized image.");
      var declared = String(payload.mimeType || "").toLowerCase();
      if (declared && declared !== "application/octet-stream" && declared.indexOf("image/") !== 0) {
        throw new AppError(ErrorCodes.UNSUPPORTED_RESULT_FORMAT, "Downloaded content type is not an image.", { mimeType: declared });
      }
      if (declared.indexOf("image/") === 0 && declared !== detected) {
        throw new AppError(ErrorCodes.UNSUPPORTED_RESULT_FORMAT, "Downloaded image bytes do not match Content-Type.", { declared: declared, detected: detected });
      }
      if (detected !== "image/png") {
        throw new AppError(ErrorCodes.UNSUPPORTED_IMAGE_FILE, "The verified Photoshop 2024 import bridge currently accepts PNG only.", { mimeType: detected });
      }
      var rootPath = this.photoshopBridge.getUserDataRoot();
      var slash = rootPath.indexOf("\\") !== -1 || /^[A-Za-z]:/.test(rootPath) ? "\\" : "/";
      var folder = rootPath + slash + "PSAIImageHubCompat";
      this.ensureDirectory(folder);
      var filePath = folder + slash + "generated-" + Date.now() + "-" + Math.floor(Math.random() * 100000) + ".png";
      var result = this.cepFs.writeFile(filePath, payload.base64, this.base64Encoding);
      if (!result || result.err !== 0) throw new AppError(ErrorCodes.TEMP_FILE_WRITE_FAILED, "Could not write generated image file.", { cepError: result && result.err });
      return { path: filePath, mimeType: detected, transient: true };
    }

    remove(filePath) {
      if (!filePath || !this.cepFs || typeof this.cepFs.deleteFile !== "function") return;
      try { this.cepFs.deleteFile(filePath); } catch (error) { /* best-effort cleanup */ }
    }
  }

  return { ImageFileStore: ImageFileStore };
}));
