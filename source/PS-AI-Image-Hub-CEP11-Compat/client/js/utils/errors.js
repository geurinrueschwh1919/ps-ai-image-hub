(function defineErrors(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createErrors() {
  "use strict";
  var ErrorCodes = Object.freeze({
    PROMPT_REQUIRED: "PROMPT_REQUIRED",
    PROMPT_EMPTY: "PROMPT_EMPTY",
    TEXT_PROVIDER_NOT_CONFIGURED: "TEXT_PROVIDER_NOT_CONFIGURED",
    TEXT_MODEL_NOT_SELECTED: "TEXT_MODEL_NOT_SELECTED",
    TEXT_API_KEY_MISSING: "TEXT_API_KEY_MISSING",
    PROMPT_OPTIMIZATION_TIMEOUT: "PROMPT_OPTIMIZATION_TIMEOUT",
    PROMPT_OPTIMIZATION_NETWORK_ERROR: "PROMPT_OPTIMIZATION_NETWORK_ERROR",
    PROMPT_OPTIMIZATION_EMPTY_RESPONSE: "PROMPT_OPTIMIZATION_EMPTY_RESPONSE",
    PROMPT_OPTIMIZATION_INVALID_RESPONSE: "PROMPT_OPTIMIZATION_INVALID_RESPONSE",
    PROMPT_OPTIMIZATION_CANCELED: "PROMPT_OPTIMIZATION_CANCELED",
    PROVIDER_REQUIRED: "PROVIDER_REQUIRED",
    MODEL_REQUIRED: "MODEL_REQUIRED",
    INVALID_PROVIDER: "INVALID_PROVIDER",
    INVALID_PROVIDER_CONFIG: "INVALID_PROVIDER_CONFIG",
    MISSING_API_KEY: "MISSING_API_KEY",
    MISSING_BASE_URL: "MISSING_BASE_URL",
    MISSING_ENDPOINT: "MISSING_ENDPOINT",
    INVALID_JSON_PATH: "INVALID_JSON_PATH",
    INVALID_REQUEST_TEMPLATE: "INVALID_REQUEST_TEMPLATE",
    NETWORK: "NETWORK",
    NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
    NETWORK_CONNECTION_TIMEOUT: "NETWORK_CONNECTION_TIMEOUT",
    GENERATION_TIMEOUT: "GENERATION_TIMEOUT",
    IMAGE_DOWNLOAD_TIMEOUT: "IMAGE_DOWNLOAD_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    CORS_ERROR: "CORS_ERROR",
    EMPTY_RESPONSE: "EMPTY_RESPONSE",
    UPSTREAM_HTML_RESPONSE: "UPSTREAM_HTML_RESPONSE",
    NON_JSON_TEXT_RESPONSE: "NON_JSON_TEXT_RESPONSE",
    UNEXPECTED_STREAM_RESPONSE: "UNEXPECTED_STREAM_RESPONSE",
    INVALID_RESPONSE: "INVALID_RESPONSE",
    INVALID_RESPONSE_STATUS: "INVALID_RESPONSE_STATUS",
    TASK_ID_UNAVAILABLE: "TASK_ID_UNAVAILABLE",
    ASYNC_PENDING: "ASYNC_PENDING",
    ASYNC_TASK_FAILED: "ASYNC_TASK_FAILED",
    ASYNC_REMOTE_CANCELED: "ASYNC_REMOTE_CANCELED",
    RECOVERY_SCHEMA_UNSUPPORTED: "RECOVERY_SCHEMA_UNSUPPORTED",
    AUTH_ERROR: "AUTH_ERROR",
    TASK_NOT_FOUND: "TASK_NOT_FOUND",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    RATE_LIMITED: "RATE_LIMITED",
    REMOTE_SERVER_ERROR: "REMOTE_SERVER_ERROR",
    CANCELLED: "CANCELLED",
    GRS_TASK_FAILED: "GRS_TASK_FAILED",
    LOCAL_REFERENCE_REQUIRES_UPLOAD: "LOCAL_REFERENCE_REQUIRES_UPLOAD",
    NO_PHOTOSHOP_SELECTION: "NO_PHOTOSHOP_SELECTION",
    REFERENCE_EXPORT_FAILED: "REFERENCE_EXPORT_FAILED",
    REFERENCE_FILE_READ_FAILED: "REFERENCE_FILE_READ_FAILED",
    REFERENCE_BASE64_ENCODE_FAILED: "REFERENCE_BASE64_ENCODE_FAILED",
    IMAGE_PAYLOAD_BUILD_FAILED: "IMAGE_PAYLOAD_BUILD_FAILED",
    INPUT_IMAGE_LIMIT: "INPUT_IMAGE_LIMIT",
    INVALID_SEED: "INVALID_SEED",
    BAILIAN_REGION_REQUIRED: "BAILIAN_REGION_REQUIRED",
    BAILIAN_REGION_UNSUPPORTED: "BAILIAN_REGION_UNSUPPORTED",
    BAILIAN_WORKSPACE_REQUIRED: "BAILIAN_WORKSPACE_REQUIRED",
    BAILIAN_API_KEY_REQUIRED: "BAILIAN_API_KEY_REQUIRED",
    BAILIAN_TASK_UNAVAILABLE: "BAILIAN_TASK_UNAVAILABLE",
    REQUEST_SERIALIZE_FAILED: "REQUEST_SERIALIZE_FAILED",
    XHR_SEND_FAILED: "XHR_SEND_FAILED",
    PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
    HTTP_CLIENT: "HTTP_CLIENT",
    HTTP_SERVER: "HTTP_SERVER",
    UNKNOWN_RESPONSE: "UNKNOWN_RESPONSE",
    INVALID_RESPONSE_FORMAT: "INVALID_RESPONSE_FORMAT",
    NO_IMAGES: "NO_IMAGES",
    BRIDGE_UNAVAILABLE: "BRIDGE_UNAVAILABLE",
    BRIDGE_RESPONSE: "BRIDGE_RESPONSE",
    PATH_SERIALIZATION_FAILED: "PATH_SERIALIZATION_FAILED",
    MISSING_GENERATED_RESULT: "MISSING_GENERATED_RESULT",
    NO_PHOTOSHOP_DOCUMENT: "NO_PHOTOSHOP_DOCUMENT",
    IMPORT_SOURCE_MISSING: "IMPORT_SOURCE_MISSING",
    UNSUPPORTED_IMAGE_SOURCE: "UNSUPPORTED_IMAGE_SOURCE",
    IMAGE_FILE_NOT_FOUND: "IMAGE_FILE_NOT_FOUND",
    UNSUPPORTED_IMAGE_FILE: "UNSUPPORTED_IMAGE_FILE",
    IMAGE_DOWNLOAD_FAILED: "IMAGE_DOWNLOAD_FAILED",
    BASE64_DECODE_FAILED: "BASE64_DECODE_FAILED",
    UNSUPPORTED_RESULT_FORMAT: "UNSUPPORTED_RESULT_FORMAT",
    TEMP_FILE_WRITE_FAILED: "TEMP_FILE_WRITE_FAILED",
    POLLING_TIMEOUT: "POLLING_TIMEOUT",
    INVALID_PNG: "INVALID_PNG",
    INVALID_IMAGE_FILE: "INVALID_IMAGE_FILE",
    PHOTOSHOP_IMPORT: "PHOTOSHOP_IMPORT",
    SMART_OBJECT_IMPORT_FAILED: "SMART_OBJECT_IMPORT_FAILED",
    LAYER_RENAME_FAILED: "LAYER_RENAME_FAILED",
    EXTENDSCRIPT_EXCEPTION: "EXTENDSCRIPT_EXCEPTION",
    RESULT_ALREADY_IMPORTED: "RESULT_ALREADY_IMPORTED",
    IMPORT_IN_PROGRESS: "IMPORT_IN_PROGRESS",
    PHOTOSHOP: "PHOTOSHOP",
    NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
    ASYNC_PROVIDER_NOT_IMPLEMENTED: "ASYNC_PROVIDER_NOT_IMPLEMENTED",
    ASYNC_NOT_IMPLEMENTED: "ASYNC_NOT_IMPLEMENTED",
    UNKNOWN: "UNKNOWN"
  });

  class AppError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AppError";
      this.code = code;
      this.details = details || null;
    }
  }

  function toUserMessage(error, t) {
    var keyByCode = {};
    keyByCode[ErrorCodes.PROMPT_REQUIRED] = "errorPromptRequired";
    keyByCode[ErrorCodes.PROMPT_EMPTY] = "errorPromptRequired";
    keyByCode[ErrorCodes.PROVIDER_REQUIRED] = "errorProviderRequired";
    keyByCode[ErrorCodes.INVALID_PROVIDER] = "errorProviderRequired";
    keyByCode[ErrorCodes.MODEL_REQUIRED] = "errorModelRequired";
    keyByCode[ErrorCodes.INVALID_PROVIDER_CONFIG] = "errorInvalidProviderConfig";
    keyByCode[ErrorCodes.MISSING_API_KEY] = "errorMissingApiKey";
    keyByCode[ErrorCodes.MISSING_BASE_URL] = "errorMissingBaseUrl";
    keyByCode[ErrorCodes.MISSING_ENDPOINT] = "errorMissingEndpoint";
    keyByCode[ErrorCodes.INVALID_JSON_PATH] = "errorInvalidJsonPath";
    keyByCode[ErrorCodes.INVALID_REQUEST_TEMPLATE] = "errorInvalidRequestTemplate";
    keyByCode[ErrorCodes.NETWORK] = "errorNetwork";
    keyByCode[ErrorCodes.NETWORK_TIMEOUT] = "errorNetworkTimeout";
    keyByCode[ErrorCodes.NETWORK_CONNECTION_TIMEOUT] = "errorConnectionTimeout";
    keyByCode[ErrorCodes.GENERATION_TIMEOUT] = "errorGenerationTimeout";
    keyByCode[ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT] = "errorImageDownloadTimeout";
    keyByCode[ErrorCodes.HTTP_ERROR] = "errorHttp";
    keyByCode[ErrorCodes.CORS_ERROR] = "errorCors";
    keyByCode[ErrorCodes.EMPTY_RESPONSE] = "errorEmptyResponse";
    keyByCode[ErrorCodes.UPSTREAM_HTML_RESPONSE] = "errorUpstreamHtmlResponse";
    keyByCode[ErrorCodes.NON_JSON_TEXT_RESPONSE] = "errorNonJsonTextResponse";
    keyByCode[ErrorCodes.UNEXPECTED_STREAM_RESPONSE] = "errorUnexpectedStreamResponse";
    keyByCode[ErrorCodes.INVALID_RESPONSE] = "errorInvalidResponseFormat";
    keyByCode[ErrorCodes.INVALID_RESPONSE_STATUS] = "errorInvalidResponseStatus";
    keyByCode[ErrorCodes.TASK_ID_UNAVAILABLE] = "errorTaskIdUnavailable";
    keyByCode[ErrorCodes.ASYNC_PENDING] = "errorAsyncPending";
    keyByCode[ErrorCodes.ASYNC_TASK_FAILED] = "errorAsyncTaskFailed";
    keyByCode[ErrorCodes.ASYNC_REMOTE_CANCELED] = "errorAsyncRemoteCanceled";
    keyByCode[ErrorCodes.RECOVERY_SCHEMA_UNSUPPORTED] = "errorRecoverySchemaUnsupported";
    keyByCode[ErrorCodes.AUTH_ERROR] = "errorAuth";
    keyByCode[ErrorCodes.TASK_NOT_FOUND] = "errorTaskNotFound";
    keyByCode[ErrorCodes.REQUEST_TIMEOUT] = "errorRequestTimeout";
    keyByCode[ErrorCodes.RATE_LIMITED] = "errorRateLimited";
    keyByCode[ErrorCodes.REMOTE_SERVER_ERROR] = "errorRemoteServer";
    keyByCode[ErrorCodes.CANCELLED] = "errorCancelled";
    keyByCode[ErrorCodes.GRS_TASK_FAILED] = "errorGrsTaskFailed";
    keyByCode[ErrorCodes.LOCAL_REFERENCE_REQUIRES_UPLOAD] = "errorLocalReferenceRequiresUpload";
    keyByCode[ErrorCodes.NO_PHOTOSHOP_SELECTION] = "errorNoPhotoshopSelection";
    keyByCode[ErrorCodes.REFERENCE_EXPORT_FAILED] = "errorReferenceExport";
    keyByCode[ErrorCodes.REFERENCE_FILE_READ_FAILED] = "errorReferenceFileRead";
    keyByCode[ErrorCodes.REFERENCE_BASE64_ENCODE_FAILED] = "errorReferenceBase64Encode";
    keyByCode[ErrorCodes.IMAGE_PAYLOAD_BUILD_FAILED] = "errorImagePayloadBuild";
    keyByCode[ErrorCodes.INPUT_IMAGE_LIMIT] = "errorInputImageLimit";
    keyByCode[ErrorCodes.INVALID_SEED] = "errorInvalidSeed";
    keyByCode[ErrorCodes.BAILIAN_REGION_REQUIRED] = "errorBailianRegionRequired";
    keyByCode[ErrorCodes.BAILIAN_REGION_UNSUPPORTED] = "errorBailianRegionUnsupported";
    keyByCode[ErrorCodes.BAILIAN_WORKSPACE_REQUIRED] = "errorBailianWorkspaceRequired";
    keyByCode[ErrorCodes.BAILIAN_API_KEY_REQUIRED] = "errorBailianApiKeyRequired";
    keyByCode[ErrorCodes.BAILIAN_TASK_UNAVAILABLE] = "errorBailianTaskUnavailable";
    keyByCode[ErrorCodes.REQUEST_SERIALIZE_FAILED] = "errorRequestSerialize";
    keyByCode[ErrorCodes.XHR_SEND_FAILED] = "errorXhrSend";
    keyByCode[ErrorCodes.PAYLOAD_TOO_LARGE] = "errorPayloadTooLarge";
    keyByCode[ErrorCodes.HTTP_CLIENT] = "errorHttpClient";
    keyByCode[ErrorCodes.HTTP_SERVER] = "errorHttpServer";
    keyByCode[ErrorCodes.UNKNOWN_RESPONSE] = "errorUnknownResponse";
    keyByCode[ErrorCodes.INVALID_RESPONSE_FORMAT] = "errorInvalidResponseFormat";
    keyByCode[ErrorCodes.NO_IMAGES] = "errorNoImages";
    keyByCode[ErrorCodes.BRIDGE_UNAVAILABLE] = "errorBridge";
    keyByCode[ErrorCodes.BRIDGE_RESPONSE] = "errorBridge";
    keyByCode[ErrorCodes.PATH_SERIALIZATION_FAILED] = "errorPathSerialization";
    keyByCode[ErrorCodes.MISSING_GENERATED_RESULT] = "errorMissingGeneratedResult";
    keyByCode[ErrorCodes.NO_PHOTOSHOP_DOCUMENT] = "errorNoPhotoshopDocument";
    keyByCode[ErrorCodes.IMPORT_SOURCE_MISSING] = "errorImportSourceMissing";
    keyByCode[ErrorCodes.UNSUPPORTED_IMAGE_SOURCE] = "errorUnsupportedImageSource";
    keyByCode[ErrorCodes.IMAGE_FILE_NOT_FOUND] = "errorImageFileNotFound";
    keyByCode[ErrorCodes.UNSUPPORTED_IMAGE_FILE] = "errorUnsupportedImageFile";
    keyByCode[ErrorCodes.IMAGE_DOWNLOAD_FAILED] = "errorImageDownload";
    keyByCode[ErrorCodes.BASE64_DECODE_FAILED] = "errorBase64Decode";
    keyByCode[ErrorCodes.UNSUPPORTED_RESULT_FORMAT] = "errorUnsupportedResultFormat";
    keyByCode[ErrorCodes.TEMP_FILE_WRITE_FAILED] = "errorTempFileWrite";
    keyByCode[ErrorCodes.POLLING_TIMEOUT] = "errorPollingTimeout";
    keyByCode[ErrorCodes.INVALID_PNG] = "errorInvalidPng";
    keyByCode[ErrorCodes.INVALID_IMAGE_FILE] = "errorInvalidImageFile";
    keyByCode[ErrorCodes.PHOTOSHOP_IMPORT] = "errorPhotoshopImport";
    keyByCode[ErrorCodes.SMART_OBJECT_IMPORT_FAILED] = "errorSmartObjectImport";
    keyByCode[ErrorCodes.LAYER_RENAME_FAILED] = "errorLayerRename";
    keyByCode[ErrorCodes.EXTENDSCRIPT_EXCEPTION] = "errorExtendScript";
    keyByCode[ErrorCodes.RESULT_ALREADY_IMPORTED] = "errorAlreadyImported";
    keyByCode[ErrorCodes.IMPORT_IN_PROGRESS] = "errorImportInProgress";
    keyByCode[ErrorCodes.PHOTOSHOP] = "errorPhotoshop";
    keyByCode[ErrorCodes.ASYNC_PROVIDER_NOT_IMPLEMENTED] = "errorAsyncNotImplemented";
    keyByCode[ErrorCodes.ASYNC_NOT_IMPLEMENTED] = "errorAsyncNotImplemented";
    var details = error && error.details;
    var message = error && error.code === ErrorCodes.BAILIAN_REGION_UNSUPPORTED
      ? t("errorBailianRegionUnsupported", {
        model: details && details.modelLabel || "Qwen Image",
        regions: details && details.supportedRegionLabels || "北京或新加坡"
      })
      : t(keyByCode[error && error.code] || "errorUnknown");
    if (!details || !details.provider) return message;
    function safe(value) {
      return String(value === undefined || value === null ? "-" : value)
        .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]").replace(/\s+/g, " ").slice(0, 240);
    }
    var stageKey = "diagnosticStage_" + String(details.stage || "unknown");
    var stage = t(stageKey);
    if (stage === stageKey) stage = details.stage || "unknown";
    var fields = [
      t("diagnosticStage", { value: safe(stage) }),
      t("diagnosticCode", { value: safe(error.code || ErrorCodes.UNKNOWN) }),
      t("diagnosticHttpStatus", { value: safe(details.status) }),
      t("diagnosticMessage", { value: safe(details.serviceMessage || error.message) }),
      t("diagnosticTimeout", { value: safe(details.effectiveTimeoutMs) }),
      t("diagnosticProvider", { value: safe(details.provider) }),
      t("diagnosticModel", { value: safe(details.model) }),
      t("diagnosticEndpoint", { value: safe(details.endpoint) })
    ];
    if (details.payloadBytes !== undefined && details.payloadBytes !== null) fields.push(t("diagnosticPayloadBytes", { value: safe(details.payloadBytes) }));
    if (error.code === ErrorCodes.GENERATION_TIMEOUT) {
      fields.push(details.canRecover && details.taskId
        ? t("taskRecoveryAvailable", { id: safe(details.taskId) })
        : t("taskRecoveryUnavailable"));
    }
    return message + "\n" + fields.join(" · ");
  }

  return { AppError: AppError, ErrorCodes: ErrorCodes, toUserMessage: toUserMessage };
}));
