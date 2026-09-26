(function defineBridgeSerialization(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createBridgeSerialization(errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var ALLOWED_HOST_METHODS = Object.freeze({
    ping: 0,
    getHostCapabilities: 0,
    getPhotoshopVersion: 0,
    hasOpenDocument: 0,
    getActiveDocumentName: 0,
    importImage: 1,
    importSmartObjectToBounds: 5,
    getDocumentMetadata: 0,
    getSelectionBounds: 0,
    exportReferenceImage: 2
  });

  function assertSerializableString(value) {
    var stringValue = String(value);
    var index;
    var code;
    if (stringValue.indexOf("\0") !== -1) {
      throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Bridge strings cannot contain a null character.");
    }
    for (index = 0; index < stringValue.length; index += 1) {
      code = stringValue.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (index + 1 >= stringValue.length || stringValue.charCodeAt(index + 1) < 0xDC00 || stringValue.charCodeAt(index + 1) > 0xDFFF) {
          throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Bridge strings contain an unmatched Unicode surrogate.");
        }
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        throw new AppError(ErrorCodes.PATH_SERIALIZATION_FAILED, "Bridge strings contain an unmatched Unicode surrogate.");
      }
    }
    return stringValue;
  }

  function serializeExtendScriptString(value) {
    return "\"" + assertSerializableString(value)
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, "\\\"")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029") + "\"";
  }

  function buildHostCall(method, args) {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_HOST_METHODS, method)) {
      throw new AppError(ErrorCodes.BRIDGE_RESPONSE, "Host bridge method is not allowed: " + method);
    }
    var values = Array.isArray(args) ? args : [];
    if (values.length !== ALLOWED_HOST_METHODS[method]) {
      throw new AppError(ErrorCodes.BRIDGE_RESPONSE, "Invalid argument count for host method: " + method);
    }
    return "PSAIImageHubCompatHost." + method + "(" + values.map(serializeExtendScriptString).join(",") + ")";
  }

  function parseBridgeResponse(raw) {
    if (!raw || raw === "EvalScript error.") {
      throw new AppError(ErrorCodes.BRIDGE_RESPONSE, "Photoshop returned an empty evalScript response.");
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) {
      throw new AppError(ErrorCodes.BRIDGE_RESPONSE, "Photoshop returned invalid bridge JSON.", { raw: String(raw).slice(0, 120) });
    }
    if (!parsed || typeof parsed.ok !== "boolean") {
      throw new AppError(ErrorCodes.BRIDGE_RESPONSE, "Photoshop returned an unknown bridge response.");
    }
    if (!parsed.ok) {
      throw new AppError(
        parsed.error && parsed.error.code || ErrorCodes.PHOTOSHOP,
        parsed.error && parsed.error.message || "Photoshop host operation failed."
      );
    }
    return parsed.data;
  }

  return {
    ALLOWED_HOST_METHODS: ALLOWED_HOST_METHODS,
    assertSerializableString: assertSerializableString,
    serializeExtendScriptString: serializeExtendScriptString,
    buildHostCall: buildHostCall,
    parseBridgeResponse: parseBridgeResponse
  };
}));
