(function defineGrsProvider(root, factory) {
  "use strict";
  var base = typeof module === "object" && module.exports ? require("./baseProvider") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var catalog = typeof module === "object" && module.exports ? require("./grsModelCatalog") : root.PSAIImageHubCompat;
  var polling = typeof module === "object" && module.exports ? require("../generation/pollingManager") : root.PSAIImageHubCompat;
  var network = typeof module === "object" && module.exports ? require("../network/apiClient") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var imageInputs = typeof module === "object" && module.exports ? require("../generation/imageInputSet") : root.PSAIImageHubCompat;
  var api = factory(base, builders, errors, catalog, polling, network, logging, imageInputs, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGrsProvider(base, builders, errors, catalog, polling, network, logging, imageInputs, runtimeRoot) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var GRS_NODES = Object.freeze({
    global: "https://grsaiapi.com",
    china: "https://grsai.dakka.com.cn"
  });
  var GRS_ENDPOINT = "/v1/api/generate";
  var GRS_RESULT_ENDPOINT = "/v1/api/result";
  var NEW_API_PROTOCOL = "new-api";
  var GRS_MODELS = catalog.GRS_MODEL_CATALOG;
  var GENERATION_TIMEOUT = network.API_TIMEOUTS && network.API_TIMEOUTS.generation || 600000;
  var CONNECTION_TIMEOUT = network.API_TIMEOUTS && network.API_TIMEOUTS.connection || 25000;
  var TERMINAL_FAILURES = Object.freeze(["failed", "violation", "cancelled"]);
  var PENDING_STATES = Object.freeze(["running", "pending", "queued", "processing"]);

  function attachDiagnostics(error, values) {
    var normalized = error instanceof AppError ? error : new AppError(ErrorCodes.UNKNOWN, error && error.message || "Unknown GRS error.");
    normalized.details = Object.assign({}, values || {}, normalized.details || {});
    return normalized;
  }

  function notifyStatus(options, status, payload) {
    if (!options || typeof options.onStatus !== "function") return;
    try { options.onStatus(status, payload); }
    catch (error) { logging.logger.warn("GRS status observer failed", { status: status, message: error && error.message }); }
  }

  function notifyTask(options, state) {
    if (!options || typeof options.onTask !== "function") return;
    try { options.onTask(state); }
    catch (error) { logging.logger.warn("GRS task observer failed", { status: state && state.status, message: error && error.message }); }
  }

  function notifyDiagnostic(options, eventName, details) {
    if (!options || typeof options.onDiagnostic !== "function") return;
    try { options.onDiagnostic(eventName, details || {}); }
    catch (error) { logging.logger.warn("GRS diagnostic observer failed", { event: eventName, message: error && error.message }); }
  }

  function createSafeTimerApi(rootObject, dependencies) {
    var injected = dependencies || {};
    var owner = injected.timerRoot || rootObject;
    return {
      startInterval: typeof injected.setInterval === "function"
        ? function startInjected(callback, delay) { return injected.setInterval(callback, delay); }
        : function startNative(callback, delay) { return owner.setInterval(callback, delay); },
      stopInterval: typeof injected.clearInterval === "function"
        ? function stopInjected(timerId) { return injected.clearInterval(timerId); }
        : function stopNative(timerId) { return owner.clearInterval(timerId); }
    };
  }

  function resolveGrsBaseUrl(config) {
    var node = config && config.node || "global";
    if (node === "custom") {
      var custom = String(config && config.customBaseUrl || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(custom)) throw new AppError(ErrorCodes.MISSING_BASE_URL, "GRS custom Base URL must use HTTP or HTTPS.");
      return custom;
    }
    if (!GRS_NODES[node]) throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Unknown GRS node.");
    return GRS_NODES[node];
  }

  function normalizeGrsConfig(input) {
    var source = input || {};
    var config = {
      id: "grs",
      displayName: "GRS",
      type: "grs",
      builtIn: true,
      protocol: source.protocol ? String(source.protocol) : NEW_API_PROTOCOL,
      node: source.node === "china" || source.node === "custom" ? source.node : "global",
      customBaseUrl: String(source.customBaseUrl || "").trim(),
      modelId: String(source.modelId || "nano-banana-2").trim(),
      imageSize: String(source.imageSize || "1K").trim() || "1K",
      replyType: ["json", "async", "stream"].indexOf(source.replyType) !== -1 ? source.replyType : "async",
      endpointPath: GRS_ENDPOINT,
      authType: "bearer",
      resultType: "url",
      responsePath: "results[0].url",
      models: GRS_MODELS.map(function copy(model) { return Object.assign({}, model); })
    };
    config.baseUrl = resolveGrsBaseUrl(config);
    return config;
  }

  function buildGrsHeaders(apiKey) {
    if (!apiKey) throw new AppError(ErrorCodes.MISSING_API_KEY, "GRS API key is required.");
    return { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
  }

  function utf8ByteLength(value) {
    var text = String(value || ""), bytes = 0;
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF) { bytes += 4; index += 1; }
      else bytes += 3;
    }
    return bytes;
  }

  function apiImageValue(reference) {
    if (!reference) return null;
    if (typeof reference.url === "string" && /^https?:\/\//i.test(reference.url)) return reference.url;
    var value = reference.apiValue || reference.base64;
    if (typeof value !== "string" || !value) return null;
    var match = value.match(/^data:[^;,]+;base64,([\s\S]*)$/i);
    return match ? match[1].replace(/\s+/g, "") : value;
  }

  function isValidGptVipPixelSize(value) {
    var match = String(value || "").match(/^(\d+)x(\d+)$/);
    if (!match) return false;
    var width = Number(match[1]);
    var height = Number(match[2]);
    var longest = Math.max(width, height);
    var shortest = Math.min(width, height);
    var pixels = width * height;
    return longest <= 3840 && width % 16 === 0 && height % 16 === 0 && longest / shortest <= 3 && pixels >= 655360 && pixels <= 8294400;
  }

  function resolveGptAspectRatio(request, model) {
    var requested = request.aspectRatio || "1:1";
    if (!model || model.id !== "gpt-image-2-vip") return requested;
    if (isValidGptVipPixelSize(requested)) return requested;
    var tier = request.resolutionTier || request.imageSize || "1K";
    var pixelSize = catalog.resolveGptVipPixelSize(requested, tier);
    if (!pixelSize) {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG,
        "gpt-image-2-vip does not support the selected aspect ratio and resolution tier.",
        { stage: "requestBuild", model: model.id, aspectRatio: requested, resolutionTier: tier });
    }
    return pixelSize;
  }

  function newApiModelFamily(model) {
    var family = model && (model.requestFamily || model.family);
    if (family === "nano-banana") return "nano";
    if (family === "gpt-image") return "gpt";
    return "unknown";
  }

  function maskTaskId(value) {
    var text = String(value || "");
    if (text.length <= 8) return text || null;
    return text.slice(0, 6) + "…" + text.slice(-4);
  }

  function resolveNewApiGenerateEndpoint(protocol) {
    if (protocol !== NEW_API_PROTOCOL) {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG,
        "GRS New API Provider cannot route a non-New protocol.", { stage: "requestBuild", protocol: protocol });
    }
    return GRS_ENDPOINT;
  }

  function validateGrsNewApiBody(body, family) {
    var common = ["model", "prompt", "images", "aspectRatio", "replyType"];
    var allowed = family === "nano-banana" ? common.concat(["imageSize"]) : common;
    Object.keys(body || {}).forEach(function validateField(name) {
      if (allowed.indexOf(name) === -1) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG,
          "GRS New API request contains a field that is not allowed for this model family.",
          { stage: "requestBuild", modelFamily: newApiModelFamily({ family: family }), unexpectedField: name });
      }
    });
    common.forEach(function requireField(name) {
      if (!Object.prototype.hasOwnProperty.call(body || {}, name)) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG,
          "GRS New API request is missing a required field.", { stage: "requestBuild", missingField: name });
      }
    });
    if (!Array.isArray(body.images)) {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "GRS New API images must be an array.",
        { stage: "requestBuild", modelFamily: newApiModelFamily({ family: family }) });
    }
    if (["async", "json", "stream"].indexOf(body.replyType) === -1) {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "GRS New API replyType is invalid.",
        { stage: "requestBuild", replyType: body.replyType });
    }
    return body;
  }

  function buildGrsHttpRequest(request, config, apiKey, model) {
    if (!model || (["nano-banana", "gpt-image"].indexOf(model.requestFamily || model.family) === -1)) {
      throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "GRS custom Model ID requires an explicit request family.");
    }
    var family = model.requestFamily || model.family;
    var protocol = config.protocol || NEW_API_PROTOCOL;
    var endpoint = resolveNewApiGenerateEndpoint(protocol);
    var orderedInputs;
    var references;
    try {
      orderedInputs = request.imageInputs ? imageInputs.orderedImageInputs(request.imageInputs) : request.references;
      references = Array.isArray(orderedInputs) ? orderedInputs.map(apiImageValue).filter(Boolean) : [];
    } catch (error) {
      throw new AppError(ErrorCodes.IMAGE_PAYLOAD_BUILD_FAILED, "GRS image payload could not be built.", { stage: "requestBuild" });
    }
    var body = {
      model: request.modelId,
      prompt: request.prompt,
      images: references,
      aspectRatio: family === "gpt-image" ? resolveGptAspectRatio(request, model) : request.aspectRatio || "auto",
      replyType: request.replyType || config.replyType || "async"
    };
    if (family === "nano-banana" && Array.isArray(model.supportedImageSizes) && model.supportedImageSizes.length) {
      body.imageSize = request.resolutionTier || request.imageSize || config.imageSize || model.supportedImageSizes[0];
    }
    validateGrsNewApiBody(body, family);
    var serialized;
    var serializeStartedAt = Date.now();
    try { serialized = JSON.stringify(body); }
    catch (error) { throw new AppError(ErrorCodes.REQUEST_SERIALIZE_FAILED, "GRS request JSON serialization failed.", { stage: "requestSerialize", imageCount: references.length }); }
    return {
      url: builders.joinUrl(resolveGrsBaseUrl(config), endpoint),
      method: "POST",
      headers: buildGrsHeaders(apiKey),
      body: serialized,
      payloadBytes: utf8ByteLength(serialized),
      imageCount: references.length,
      serializeMs: Date.now() - serializeStartedAt,
      replyType: body.replyType,
      protocol: protocol,
      modelFamily: newApiModelFamily(model),
      endpoint: endpoint,
      aspectRatio: body.aspectRatio,
      hasImageSize: Object.prototype.hasOwnProperty.call(body, "imageSize"),
      imageSize: Object.prototype.hasOwnProperty.call(body, "imageSize") ? body.imageSize : null,
      resolutionMappingStatus: model.newApiCapabilities && model.newApiCapabilities.resolutionMappingStatus || null
    };
  }

  function parseGrsNewApiTaskState(response) {
    if (!response || typeof response !== "object") throw new AppError(ErrorCodes.INVALID_RESPONSE_FORMAT, "GRS response is not an object.");
    var numericProgress = response.progress === null || response.progress === undefined ? null : Number(response.progress);
    return {
      id: response.id ? String(response.id) : null,
      status: response.status ? String(response.status).toLowerCase() : null,
      results: Array.isArray(response.results) ? response.results.slice() : [],
      progress: numericProgress !== null && isFinite(numericProgress) ? numericProgress : null,
      error: response.error ? String(response.error) : null
    };
  }

  var parseGrsTaskState = parseGrsNewApiTaskState;

  function assertTaskState(state) {
    if (!state.status) throw new AppError(ErrorCodes.INVALID_RESPONSE, "GRS response is missing status.");
    if (TERMINAL_FAILURES.indexOf(state.status) !== -1) {
      throw new AppError(ErrorCodes.GRS_TASK_FAILED,
        state.error || "GRS generation did not succeed.", { id: state.id, status: state.status, progress: state.progress });
    }
    if (state.status !== "succeeded" && PENDING_STATES.indexOf(state.status) === -1) {
      throw new AppError(ErrorCodes.INVALID_RESPONSE_STATUS, "GRS returned an unknown task status.",
        { responseStatus: state.status, taskId: state.id });
    }
    return state;
  }

  class GrsProvider extends base.BaseProvider {
    constructor(config, dependencies) {
      dependencies = dependencies || {};
      var normalized = normalizeGrsConfig(config);
      super({
        id: "grs",
        displayName: "GRS",
        type: "grs",
        models: normalized.models,
        capabilities: { supportsTextToImage: true, supportsImageToImage: true, supportsMultipleReferences: true, supportsAspectRatio: true, supportsCustomModels: true }
      });
      this.isBuiltIn = true;
      this.config = normalized;
      this.apiClient = dependencies.apiClient;
      this.secretStore = dependencies.secretStore;
      this.pollingManager = dependencies.pollingManager || new polling.PollingManager();
      this.taskStore = dependencies.taskStore || null;
      this.accountClient = dependencies.accountClient || null;
      this.timerApi = createSafeTimerApi(dependencies.runtimeRoot || runtimeRoot, dependencies);
      this.generationTimeoutMs = GENERATION_TIMEOUT;
    }

    secretName() { return "provider:grs:apiKey"; }
    apiKey() { return this.secretStore.get(this.secretName()); }

    updateConfig(config) {
      var runtimeModels = this.models.filter(function custom(model) {
        return !GRS_MODELS.some(function confirmed(item) { return item.id === model.id; });
      });
      this.config = normalizeGrsConfig(config);
      this.models = Object.freeze(this.config.models.concat(runtimeModels));
      return this.config;
    }

    validateConfig() {
      var validationErrors = [];
      var code = ErrorCodes.INVALID_PROVIDER_CONFIG;
      if (this.config.protocol !== NEW_API_PROTOCOL) validationErrors.push("Built-in GRS Provider requires protocol=new-api.");
      try { resolveGrsBaseUrl(this.config); }
      catch (error) { validationErrors.push(error.message); code = error.code; }
      if (!this.apiKey()) { validationErrors.push("GRS API key is required."); code = ErrorCodes.MISSING_API_KEY; }
      if (!this.config.modelId) validationErrors.push("GRS Model ID is required.");
      return { valid: validationErrors.length === 0, errors: validationErrors, code: code, config: this.config };
    }

    testConnection() {
      var validation = this.validateConfig();
      if (!validation.valid) return Promise.reject(new AppError(validation.code, validation.errors[0]));
      return Promise.resolve({ ok: true, mode: "configuration-only", providerId: this.id });
    }

    saveTask(state, modelId) {
      if (!state || !state.id) return null;
      this.lastTaskId = state.id;
      if (!this.taskStore) return state;
      return this.taskStore.save({
        id: state.id, status: state.status, progress: state.progress, node: this.config.node,
        baseUrl: resolveGrsBaseUrl(this.config), modelId: modelId || this.config.modelId
      });
    }

    getRecoverableTask() {
      var task = this.taskStore && this.taskStore.load();
      return task && PENDING_STATES.indexOf(task.status) !== -1 ? task : null;
    }

    async queryTask(taskId, context) {
      var baseUrl = context && context.baseUrl || resolveGrsBaseUrl(this.config);
      var url = builders.joinUrl(baseUrl, GRS_RESULT_ENDPOINT) + "?id=" + encodeURIComponent(taskId);
      var modelId = context && context.modelId || this.config.modelId;
      var modelFamily = context && context.modelFamily || newApiModelFamily(this.getModel(modelId));
      var maskedTaskId = maskTaskId(taskId);
      notifyStatus(context, "fetchingResult", { taskId: taskId });
      return this.apiClient.requestJson(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + this.apiKey() },
        timeout: CONNECTION_TIMEOUT,
        timeoutContext: "connection",
        httpErrorCode: ErrorCodes.HTTP_ERROR,
        corsAware: true,
        cancellationToken: context && context.cancellationToken,
        allowEmbeddedJson: true,
        allowTaskEnvelope: true,
        diagnostics: { stage: "polling", provider: "GRS", model: modelId, modelFamily: modelFamily,
          method: "GET", endpoint: GRS_RESULT_ENDPOINT, protocol: NEW_API_PROTOCOL, taskId: maskedTaskId },
        onRequestConfigured: function configured(xhr, meta) {
          logging.logger.info("GRS result request configured", { protocol: NEW_API_PROTOCOL, provider: "GRS", model: modelId,
            modelFamily: modelFamily, method: "GET", endpoint: GRS_RESULT_ENDPOINT, taskId: maskedTaskId,
            effectiveTimeoutMs: meta.effectiveTimeoutMs });
        },
        onResponseDiagnostics: function responseObserved(details) {
          logging.logger.info("GRS New API result response diagnostics", Object.assign({
            provider: "GRS", model: modelId, modelFamily: modelFamily, method: "GET",
            endpoint: GRS_RESULT_ENDPOINT, protocol: NEW_API_PROTOCOL, taskId: maskedTaskId
          }, details));
        }
      });
    }

    async recoverTask(taskId, context) {
      var savedTask = this.taskStore && this.taskStore.load();
      var options = Object.assign({}, context || {});
      if (savedTask && savedTask.id === String(taskId) && /^https?:\/\//i.test(savedTask.baseUrl || "")) options.baseUrl = savedTask.baseUrl;
      var modelId = options.modelId || this.config.modelId;
      options.modelFamily = options.modelFamily || newApiModelFamily(this.getModel(modelId));
      var taskWaitStartedAt = Number(options.taskWaitStartedAt) || Date.now();
      return this.pollingManager.poll(async (attempt) => {
        var response = await this.queryTask(taskId, options);
        var state = assertTaskState(parseGrsNewApiTaskState(response));
        if (!state.id) state.id = String(taskId);
        logging.logger.info("GRS New API result state", { protocol: NEW_API_PROTOCOL, model: modelId,
          modelFamily: options.modelFamily, method: "GET", endpoint: GRS_RESULT_ENDPOINT,
          taskId: maskTaskId(state.id), status: state.status, progress: state.progress });
        this.saveTask(state, modelId);
        notifyTask(options, state);
        if (state.status === "succeeded") {
          var taskWaitMs = Date.now() - taskWaitStartedAt;
          logging.logImagePipeline(8, "RESULT_URL_RECEIVED", { taskId: maskTaskId(state.id), taskWaitMs: taskWaitMs, responseStatus: state.status });
          notifyDiagnostic(options, "RESULT_URL_RECEIVED", { taskId: state.id, taskWaitMs: taskWaitMs });
          return { done: true, value: response };
        }
        notifyStatus(options, "generating", { taskId: state.id, progress: state.progress, attempt: attempt });
        return { done: false };
      }, { interval: 3000, maxAttempts: 201, timeoutMs: GENERATION_TIMEOUT, cancellationToken: options.cancellationToken });
    }

    async generate(request, context) {
      var validation = this.validateConfig();
      if (!validation.valid) throw new AppError(validation.code, validation.errors[0]);
      var model = this.getModel(request.modelId);
      var options = context || {};
      this.lastTaskId = null;
      var httpRequest;
      try { httpRequest = buildGrsHttpRequest(request, this.config, this.apiKey(), model); }
      catch (error) {
        var buildError = attachDiagnostics(error, { stage: error && error.details && error.details.stage || "requestBuild", provider: "GRS", model: request.modelId, endpoint: GRS_ENDPOINT });
        logging.logger.error("GRS request build failed", buildError); throw buildError;
      }
      logging.logger.info("GRS New API endpoint diagnostics", {
        protocol: httpRequest.protocol, model: request.modelId, modelFamily: httpRequest.modelFamily,
        method: httpRequest.method, endpoint: httpRequest.endpoint, replyType: httpRequest.replyType,
        aspectRatio: httpRequest.aspectRatio, hasImageSize: httpRequest.hasImageSize,
        imageSize: httpRequest.imageSize, imageCount: httpRequest.imageCount, payloadBytes: httpRequest.payloadBytes
      });
      if (httpRequest.imageCount) {
        var optimization = request.imageOptimization || {};
        var beforeFullPayloadBytes = optimization.beforeOptimizationPayloadBytes !== undefined && optimization.afterOptimizationPayloadBytes !== undefined
          ? httpRequest.payloadBytes - optimization.afterOptimizationPayloadBytes + optimization.beforeOptimizationPayloadBytes
          : httpRequest.payloadBytes;
        var fullReductionPercent = beforeFullPayloadBytes > 0
          ? Number((Math.max(0, beforeFullPayloadBytes - httpRequest.payloadBytes) / beforeFullPayloadBytes * 100).toFixed(1))
          : 0;
        logging.logImagePipeline(5, "IMAGE_PAYLOAD_PREFLIGHT", {
          model: request.modelId, imageCount: httpRequest.imageCount, mainImageCount: optimization.mainImageCount,
          referenceCount: optimization.referenceCount, sourceDimensions: optimization.sourceDimensions,
          sentDimensions: optimization.sentDimensions, encodedBytesPerImage: optimization.encodedBytesPerImage,
          beforeOptimizationPayloadBytes: beforeFullPayloadBytes,
          afterOptimizationPayloadBytes: httpRequest.payloadBytes, reductionPercent: fullReductionPercent,
          softTargetBytes: optimization.softTargetBytes, passCount: optimization.passCount
        });
        logging.logImagePipeline(5, "REQUEST_BODY_READY", {
          model: request.modelId, imageCount: httpRequest.imageCount, aspectRatio: request.aspectRatio,
          resolutionTier: request.resolutionTier, payloadBytes: httpRequest.payloadBytes, requestPayloadBytes: httpRequest.payloadBytes,
          serializeMs: httpRequest.serializeMs
        });
        notifyDiagnostic(options, "REQUEST_BODY_READY", { serializeMs: httpRequest.serializeMs, requestPayloadBytes: httpRequest.payloadBytes });
      }
      var elapsedSeconds = 0;
      var timer = this.timerApi.startInterval(function elapsed() {
        if (elapsedSeconds >= 600) return;
        elapsedSeconds = Math.min(600, elapsedSeconds + 30);
        notifyStatus(options, "waiting", { seconds: elapsedSeconds });
      }, 30000);
      try {
        notifyStatus(options, "connecting");
        var xhrSendEnteredAt = null;
        var submissionTimeoutMs = httpRequest.replyType === "async" ? CONNECTION_TIMEOUT : GENERATION_TIMEOUT;
        var submissionTimeoutContext = httpRequest.replyType === "async" ? "connection" : "generation";
        var requestDiagnostics = { stage: "request", provider: "GRS", model: request.modelId, modelFamily: httpRequest.modelFamily,
          method: httpRequest.method, endpoint: httpRequest.endpoint,
          effectiveTimeoutMs: submissionTimeoutMs, payloadBytes: httpRequest.payloadBytes, imageCount: httpRequest.imageCount,
          protocol: httpRequest.protocol, replyType: httpRequest.replyType, aspectRatio: httpRequest.aspectRatio,
          hasImageSize: httpRequest.hasImageSize, imageSize: httpRequest.imageSize };
        var responsePromise = this.apiClient.requestJson(httpRequest.url, Object.assign({}, httpRequest, {
          timeout: submissionTimeoutMs,
          timeoutContext: submissionTimeoutContext,
          httpErrorCode: ErrorCodes.HTTP_ERROR,
          corsAware: true,
          cancellationToken: options.cancellationToken,
          allowEmbeddedJson: true,
          allowTaskEnvelope: true,
          diagnostics: requestDiagnostics,
          sendErrorCode: ErrorCodes.XHR_SEND_FAILED,
          onRequestConfigured: function configured(xhr, meta) {
            requestDiagnostics.effectiveTimeoutMs = Number(xhr.timeout);
            logging.logger.info("GRS request configured", { protocol: httpRequest.protocol, provider: "GRS", model: request.modelId,
              modelFamily: httpRequest.modelFamily, method: httpRequest.method, endpoint: httpRequest.endpoint,
              replyType: httpRequest.replyType, aspectRatio: httpRequest.aspectRatio,
              hasImageSize: httpRequest.hasImageSize, imageSize: httpRequest.imageSize,
              imageCount: httpRequest.imageCount, payloadBytes: httpRequest.payloadBytes,
              effectiveTimeoutMs: meta.effectiveTimeoutMs });
          },
          onSendEntered: function sendEntered(xhr, meta) {
            xhrSendEnteredAt = Date.now();
            if (httpRequest.imageCount) logging.logImagePipeline(6, "XHR_SEND_ENTERED", { endpoint: GRS_ENDPOINT, effectiveTimeoutMs: meta.effectiveTimeoutMs, payloadBytes: httpRequest.payloadBytes, imageCount: httpRequest.imageCount });
          },
          onRequestStarted: function submitted() {
            if (httpRequest.imageCount) logging.logImagePipeline(7, "XHR_REQUEST_STARTED", { endpoint: GRS_ENDPOINT, effectiveTimeoutMs: requestDiagnostics.effectiveTimeoutMs, payloadBytes: httpRequest.payloadBytes, imageCount: httpRequest.imageCount });
            notifyStatus(options, "requestSubmitted");
            notifyStatus(options, "generating");
          },
          onResponseReceived: function responseReceived(xhr, meta) {
            var roundTripMs = xhrSendEnteredAt === null ? meta.durationMs : Date.now() - xhrSendEnteredAt;
            logging.logImagePipeline(7, "XHR_RESPONSE_RECEIVED", { endpoint: GRS_ENDPOINT, effectiveTimeoutMs: meta.effectiveTimeoutMs,
              requestRoundTripBeforeTaskMs: roundTripMs, xhrSendToFirstResponseMs: roundTripMs, responseStatus: xhr.status });
            notifyDiagnostic(options, "XHR_RESPONSE_RECEIVED", { requestRoundTripBeforeTaskMs: roundTripMs });
          },
          onResponseDiagnostics: function responseObserved(details) {
            logging.logger.info("GRS New API generate response diagnostics", Object.assign({
              provider: "GRS", model: request.modelId, modelFamily: httpRequest.modelFamily,
              method: httpRequest.method, endpoint: httpRequest.endpoint, protocol: httpRequest.protocol,
              replyType: httpRequest.replyType, aspectRatio: httpRequest.aspectRatio,
              hasImageSize: httpRequest.hasImageSize, imageSize: httpRequest.imageSize,
              imageCount: httpRequest.imageCount, payloadBytes: httpRequest.payloadBytes
            }, details));
          }
        }));
        var response = await responsePromise;
        var state = assertTaskState(parseGrsNewApiTaskState(response));
        logging.logger.info("GRS response received", { provider: "GRS", model: request.modelId, endpoint: GRS_ENDPOINT,
          effectiveTimeoutMs: requestDiagnostics.effectiveTimeoutMs, taskId: maskTaskId(state.id), responseStatus: state.status,
          imageCount: state.results.length });
        this.saveTask(state, request.modelId);
        notifyTask(options, state);
        if (state.id) {
          logging.logImagePipeline(8, "TASK_ID_RECEIVED", { taskId: maskTaskId(state.id), responseStatus: state.status });
          notifyDiagnostic(options, "TASK_ID_RECEIVED", { taskId: state.id, taskWaitMs: 0 });
        }
        if (state.status === "succeeded") {
          logging.logImagePipeline(8, "RESULT_URL_RECEIVED", { taskId: maskTaskId(state.id), taskWaitMs: 0, responseStatus: state.status });
          notifyDiagnostic(options, "RESULT_URL_RECEIVED", { taskId: state.id, taskWaitMs: 0 });
          return response;
        }
        if (!state.id) throw new AppError(ErrorCodes.TASK_ID_UNAVAILABLE,
          "GRS request may have been sent, but the response contains no recoverable Task ID.",
          { responseStatus: state.status });
        notifyStatus(options, "taskSubmitted", { taskId: state.id, progress: state.progress });
        notifyStatus(options, "generating", { taskId: state.id, progress: state.progress });
        return this.recoverTask(state.id, Object.assign({}, options, { modelId: request.modelId,
          modelFamily: httpRequest.modelFamily, taskWaitStartedAt: Date.now() }));
      } catch (error) {
        var diagnosed = attachDiagnostics(error, { stage: "request", provider: "GRS", model: request.modelId,
          endpoint: GRS_ENDPOINT, effectiveTimeoutMs: typeof submissionTimeoutMs === "number" ? submissionTimeoutMs : GENERATION_TIMEOUT,
          taskId: this.lastTaskId || null,
          canRecover: Boolean(this.lastTaskId) });
        logging.logger.error("GRS request failed", diagnosed);
        throw diagnosed;
      } finally {
        this.timerApi.stopInterval(timer);
      }
    }

    parseResponse(response) {
      var state = parseGrsNewApiTaskState(response);
      assertTaskState(state);
      if (state.status !== "succeeded") throw new AppError(ErrorCodes.ASYNC_PENDING, "GRS task is still pending.", { id: state.id, status: state.status });
      return state;
    }

    extractImages(state) {
      var images = state.results.map(function map(item, index) {
        if (!item || typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return null;
        return {
          id: "grs-" + (state.id || index),
          mimeType: "image/png",
          previewSource: item.url,
          importSource: { type: "url", url: item.url },
          rawResponseMeta: { id: state.id, status: state.status, progress: state.progress }
        };
      }).filter(Boolean);
      if (!images.length) throw new AppError(ErrorCodes.INVALID_RESPONSE_FORMAT, "GRS succeeded response contains no results URL.");
      return images;
    }

    getReadOnlyInfo() {
      return { protocol: NEW_API_PROTOCOL, baseUrl: resolveGrsBaseUrl(this.config), endpoint: GRS_ENDPOINT,
        resultEndpoint: GRS_RESULT_ENDPOINT, auth: "Bearer Token", generationTimeoutMs: GENERATION_TIMEOUT };
    }
    resolveBaseUrl(config) { return resolveGrsBaseUrl(config || this.config); }
  }

  return {
    GrsProvider: GrsProvider,
    GRS_NODES: GRS_NODES,
    GRS_MODELS: GRS_MODELS,
    GRS_ENDPOINT: GRS_ENDPOINT,
    GRS_RESULT_ENDPOINT: GRS_RESULT_ENDPOINT,
    GRS_NEW_API_PROTOCOL: NEW_API_PROTOCOL,
    resolveGrsBaseUrl: resolveGrsBaseUrl,
    normalizeGrsConfig: normalizeGrsConfig,
    buildGrsHeaders: buildGrsHeaders,
    buildGrsHttpRequest: buildGrsHttpRequest,
    validateGrsNewApiBody: validateGrsNewApiBody,
    resolveNewApiGenerateEndpoint: resolveNewApiGenerateEndpoint,
    newApiModelFamily: newApiModelFamily,
    maskTaskId: maskTaskId,
    parseGrsTaskState: parseGrsTaskState,
    parseGrsNewApiTaskState: parseGrsNewApiTaskState,
    resolveGptAspectRatio: resolveGptAspectRatio,
    isValidGptVipPixelSize: isValidGptVipPixelSize,
    createSafeTimerApi: createSafeTimerApi,
    utf8ByteLength: utf8ByteLength,
    GRS_GENERATION_TIMEOUT: GENERATION_TIMEOUT,
    GRS_CONNECTION_TIMEOUT: CONNECTION_TIMEOUT
  };
}));
