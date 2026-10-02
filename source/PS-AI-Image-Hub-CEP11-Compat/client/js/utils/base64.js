(function defineBase64(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports ? require("./errors") : root.PSAIImageHubCompat;
  var api = factory(errors, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createBase64(errors, root) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function normalizeBase64(value) {
    var text = String(value || "").trim();
    var match = text.match(/^data:([^;,]+);base64,(.*)$/i);
    var mimeType = match ? match[1].toLowerCase() : null;
    var base64 = (match ? match[2] : text).replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new AppError(ErrorCodes.BASE64_DECODE_FAILED, "Image Base64 data is invalid.");
    }
    while (base64.length % 4) base64 += "=";
    return { base64: base64, mimeType: mimeType };
  }

  function base64ToBytes(value) {
    var normalized = normalizeBase64(value);
    var binary;
    try { binary = root.atob(normalized.base64); }
    catch (error) { throw new AppError(ErrorCodes.BASE64_DECODE_FAILED, "Image Base64 data cannot be decoded."); }
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes: bytes, base64: normalized.base64, mimeType: normalized.mimeType };
  }

  function bytesToBase64(value) {
    var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    var chunks = [];
    var size = 0x4000;
    for (var offset = 0; offset < bytes.length; offset += size) {
      var end = Math.min(offset + size, bytes.length);
      var binaryChunk = "";
      for (var index = offset; index < end; index += 1) binaryChunk += String.fromCharCode(bytes[index]);
      chunks.push(binaryChunk);
    }
    return root.btoa(chunks.join(""));
  }

  function base64DecodedByteLength(value) {
    var normalized = normalizeBase64(value).base64;
    var padding = normalized.slice(-2) === "==" ? 2 : normalized.slice(-1) === "=" ? 1 : 0;
    return Math.max(0, (normalized.length / 4) * 3 - padding);
  }

  function detectImageMimeType(value) {
    var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
  }

  function canonicalImageMimeType(value) {
    var mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  function hasCompleteImageSignature(value, mimeType) {
    var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    var canonical = canonicalImageMimeType(mimeType || detectImageMimeType(bytes));
    var index;
    if (canonical === "image/png") return bytes.length >= 8 && detectImageMimeType(bytes) === "image/png";
    if (canonical === "image/jpeg") {
      if (bytes.length < 4 || detectImageMimeType(bytes) !== "image/jpeg") return false;
      for (index = bytes.length - 2; index >= 2; index -= 1) {
        if (bytes[index] === 0xFF && bytes[index + 1] === 0xD9) return true;
      }
      return false;
    }
    return false;
  }

  return {
    normalizeBase64: normalizeBase64,
    base64ToBytes: base64ToBytes,
    bytesToBase64: bytesToBase64,
    base64DecodedByteLength: base64DecodedByteLength,
    detectImageMimeType: detectImageMimeType,
    canonicalImageMimeType: canonicalImageMimeType,
    hasCompleteImageSignature: hasCompleteImageSignature
  };
}));
