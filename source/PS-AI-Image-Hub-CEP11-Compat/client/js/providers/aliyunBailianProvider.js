(function defineAliyunBailianProvider(root, factory) {
  "use strict";
  var asyncProvider = typeof module === "object" && module.exports ? require("./asyncTaskProvider") : root.PSAIImageHubCompat;
  var definitions = typeof module === "object" && module.exports ? require("./asyncTaskDefinition") : root.PSAIImageHubCompat;
  var bailianDefinition = typeof module === "object" && module.exports ? require("./aliyunBailianDefinition") : root.PSAIImageHubCompat;
  var catalog = typeof module === "object" && module.exports ? require("./aliyunBailianCatalog") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var api = factory(asyncProvider, definitions, bailianDefinition, catalog, errors, logging);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAliyunBailianProvider(asyncProvider, definitions, bailianDefinition, catalog, errors, logging) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function shortFingerprint(value) {
    var text = String(value || ""), hash = 2166136261, index;
    for (index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return text ? ("00000000" + (hash >>> 0).toString(16)).slice(-8) : "none";
  }

  function originOf(value) {
    var match = String(value || "").match(/^(https:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : "";
  }

  function hostType(endpointMode, region) {
    if (endpointMode === "shared") return region === "cn-beijing" ? "shared-beijing"
      : region === "ap-southeast-1" ? "shared-singapore" : "shared-unsupported";
    return "workspace-dedicated";
  }

  function mapBailianServiceError(error) {
    if (!(error instanceof AppError)) return error;
    var details = error.details || {};
    var serviceCode = String(details.serviceCode || "");
    var message = String(details.serviceMessage || error.message || "");
    if (/workspace endpoint is invalid/i.test(message)) return new AppError(ErrorCodes.BAILIAN_WORKSPACE_ENDPOINT_INVALID,
      "The Alibaba Model Studio dedicated endpoint is invalid.", details);
    if (/InvalidApiKey/i.test(serviceCode) || /invalid api[- ]?key/i.test(message)) return new AppError(ErrorCodes.AUTH_ERROR,
      "Alibaba Model Studio rejected the API key.", details);
    if (/ModelNotFound/i.test(serviceCode) || /model.+not found/i.test(message)) return new AppError(ErrorCodes.MODEL_REQUIRED,
      "Alibaba Model Studio rejected the Model ID.", details);
    if (/region/i.test(message) && /mismatch|different|invalid/i.test(message)) return new AppError(ErrorCodes.BAILIAN_REGION_MISMATCH,
      "Alibaba Model Studio region does not match the configured API host.", details);
    if (/InvalidParameter/i.test(serviceCode)) return new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG,
      "Alibaba Model Studio rejected the request parameters.", details);
    return error;
  }

  class AliyunBailianProvider extends asyncProvider.AsyncTaskProvider {
    constructor(config, dependencies) {
      var normalized = catalog.normalizeAliyunBailianConfig(config);
      var injected = Object.assign({}, dependencies || {}, { definition: bailianDefinition.createAliyunBailianAsyncDefinition() });
      super(normalized, injected);
      this.isBuiltIn = true;
      this.id = catalog.ALIYUN_BAILIAN_PROVIDER_ID;
      this.displayName = "阿里云百炼";
      this.type = this.id;
      this.config = normalized;
      this.models = Object.freeze(catalog.ALIYUN_BAILIAN_MODEL_CATALOG.slice());
      this.capabilities = Object.freeze({
        supportsTextToImage: true,
        supportsImageToImage: true,
        supportsMultipleReferences: true,
        maxReferenceImages: 3,
        maxInputImages: 3,
        supportsMask: false,
        supportsNegativePrompt: true,
        supportsAspectRatio: true,
        supportsSeed: true,
        supportsPromptExtend: true,
        supportsThinking: true,
        supportsMultipleOutputs: true,
        supportsWatermark: true,
        supportsAsync: true,
        supportsServerCancel: false,
        supportsCustomModels: false,
        outputFormat: "png",
        executionMode: "async"
      });
    }

    updateConfig(config) {
      this.config = catalog.normalizeAliyunBailianConfig(config);
      this.models = Object.freeze(catalog.ALIYUN_BAILIAN_MODEL_CATALOG.slice());
      return this.config;
    }

    validateConfig() {
      var issues = [];
      var code = ErrorCodes.INVALID_PROVIDER_CONFIG;
      var definitionValidation = definitions.validateAsyncTaskDefinition(this.definition);
      if (!definitionValidation.valid) issues = issues.concat(definitionValidation.errors);
      if (!this.config.region) { issues.push("Alibaba Cloud Model Studio requires a Region."); code = ErrorCodes.BAILIAN_REGION_REQUIRED; }
      else if (!catalog.getAliyunBailianRegion(this.config.region)) issues.push("Bailian region is unsupported.");
      if (this.config.endpointMode === "dedicated" && !this.config.dedicatedApiHost) {
        issues.push("Alibaba Cloud Model Studio requires a dedicated API Host.");
        if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_WORKSPACE_REQUIRED;
      }
      else if (this.config.endpointMode === "dedicated") {
        var parsedHost = catalog.parseAliyunDedicatedApiHost(this.config.dedicatedApiHost);
        if (!parsedHost.valid) {
          issues.push("Alibaba Cloud Model Studio dedicated API Host is invalid.");
          if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_WORKSPACE_FORMAT;
        } else if (parsedHost.region !== this.config.region) {
          issues.push("Alibaba Cloud Model Studio dedicated API Host region does not match the selected Region.");
          if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_REGION_MISMATCH;
        }
      }
      if (!this.apiKey()) {
        issues.push("Alibaba Cloud Model Studio requires an API Key.");
        if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_API_KEY_REQUIRED;
      }
      var selectedModel = this.getModel(this.config.modelId);
      if (!selectedModel) {
        issues.push("Bailian Model ID is unsupported.");
        if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.MODEL_REQUIRED;
      }
      else if (this.config.region && !catalog.isAliyunBailianRegionSupported(selectedModel.id, this.config.region)) {
        issues.push(selectedModel.displayName + " does not support the selected Region.");
        if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_REGION_UNSUPPORTED;
      }
      return { valid: issues.length === 0, errors: issues, code: code, config: this.config, definition: this.definition };
    }

    assertSubmitRegionSupported(request) {
      var modelId = String(request && request.modelId || this.config.modelId || "");
      var model = this.getModel(modelId);
      var endpointContext = this.endpointContext(request, null);
      if (!model || !endpointContext.region || catalog.isAliyunBailianRegionSupported(modelId, endpointContext.region)) return;
      var supportedRegions = catalog.getAliyunBailianSupportedRegions(modelId);
      throw new AppError(ErrorCodes.BAILIAN_REGION_UNSUPPORTED,
        model.displayName + " does not support the selected Region.", {
          modelLabel: model.displayName,
          supportedRegionLabels: supportedRegions.map(function label(region) { return region.label; }).join("或")
        });
    }

    async submit(request, context) {
      this.assertSubmitRegionSupported(request);
      this.assertSubmitConfiguration(request);
      try { return await super.submit(request, context); }
      catch (error) { throw mapBailianServiceError(error); }
    }

    assertSubmitConfiguration(request) {
      var validation = this.validateConfig();
      if (!validation.valid) throw new AppError(validation.code || ErrorCodes.INVALID_PROVIDER_CONFIG,
        validation.errors[0] || "Alibaba Model Studio configuration is invalid.");
      var endpoint = this.endpointContext(request, null);
      var submitUrl = catalog.buildBailianSubmitUrl(endpoint.dedicatedApiHost, endpoint.region, endpoint.endpointMode);
      var expectedOrigin = catalog.resolveAliyunBailianBaseUrl(endpoint.region, endpoint.dedicatedApiHost, endpoint.endpointMode);
      if (!submitUrl || !expectedOrigin || originOf(submitUrl) !== originOf(expectedOrigin)) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Alibaba Model Studio endpoint could not be resolved safely.");
      }
      if (endpoint.endpointMode === "shared" && /\.maas\.aliyuncs\.com$/i.test(originOf(submitUrl))) {
        throw new AppError(ErrorCodes.INVALID_PROVIDER_CONFIG, "Shared mode resolved to a dedicated host.");
      }
      return endpoint;
    }

    endpointContext(request, task) {
      var requestMetadata = request && request.providerMetadata || {};
      var saved = task && task.requestConfiguration || {};
      var currentRevision = Math.max(0, Math.floor(Number(this.config.providerConfigRevision) || 0));
      var metadataRevision = Math.max(0, Math.floor(Number(requestMetadata.providerConfigRevision) || 0));
      var live = !task && requestMetadata.providerConfigRevision !== undefined && metadataRevision === currentRevision
        ? requestMetadata : this.config;
      return { region: String(task ? saved.region || this.config.region || "" : live.region || ""),
        dedicatedApiHost: String(task ? saved.dedicatedApiHost || this.config.dedicatedApiHost || "" : live.dedicatedApiHost || ""),
        endpointMode: catalog.normalizeAliyunBailianEndpointMode(task ? saved.endpointMode || this.config.endpointMode : live.endpointMode),
        providerConfigRevision: task ? Math.max(0, Math.floor(Number(saved.providerConfigRevision) || currentRevision)) : currentRevision };
    }

    buildHttpRequest(section, request, task, context) {
      var http = super.buildHttpRequest(section, request, task, context);
      var endpointContext = this.endpointContext(request, task);
      var isSubmit = section === this.definition.submit;
      var isPoll = section === this.definition.poll;
      if (isSubmit) http.url = catalog.buildBailianSubmitUrl(endpointContext.dedicatedApiHost, endpointContext.region, endpointContext.endpointMode);
      else if (isPoll) http.url = task && task.pollUrl || catalog.buildBailianPollUrl(endpointContext.dedicatedApiHost, endpointContext.region, task && task.id, endpointContext.endpointMode);
      var submitEndpoint = catalog.buildBailianSubmitUrl(endpointContext.dedicatedApiHost, endpointContext.region, endpointContext.endpointMode);
      var pollEndpoint = task && task.id
        ? catalog.buildBailianPollUrl(endpointContext.dedicatedApiHost, endpointContext.region, task.id, endpointContext.endpointMode)
        : catalog.resolveAliyunBailianBaseUrl(endpointContext.region, endpointContext.dedicatedApiHost, endpointContext.endpointMode) + "/api/v1/tasks/{taskId}";
      var origin = originOf(submitEndpoint);
      http.diagnostics = Object.assign({}, http.diagnostics || {}, {
        provider: this.id,
        model: request && request.modelId || task && task.modelId || this.config.modelId,
        region: endpointContext.region,
        endpointMode: endpointContext.endpointMode,
        hostType: hostType(endpointContext.endpointMode, endpointContext.region),
        apiHostFingerprint: shortFingerprint(origin),
        providerConfigRevision: endpointContext.providerConfigRevision,
        submitOriginFingerprint: shortFingerprint(originOf(submitEndpoint)),
        pollOriginFingerprint: shortFingerprint(originOf(pollEndpoint)),
        endpoint: this.definition.submit.endpoint
      });
      logging.logger.info("BAILIAN_REQUEST_CONFIGURED", {
        stage: isSubmit ? "submit" : isPoll ? "polling" : "other",
        provider: this.id,
        model: http.diagnostics.model,
        region: endpointContext.region,
        endpointMode: endpointContext.endpointMode,
        hostType: http.diagnostics.hostType,
        apiHostFingerprint: http.diagnostics.apiHostFingerprint,
        providerConfigRevision: endpointContext.providerConfigRevision
      });
      return http;
    }

    createTask(submitResponse, request) {
      var task = super.createTask(submitResponse, request);
      var endpointContext = this.endpointContext(request, null);
      task.pollUrl = catalog.buildBailianPollUrl(endpointContext.dedicatedApiHost, endpointContext.region, task.id, endpointContext.endpointMode);
      task.requestConfiguration = Object.assign({}, task.requestConfiguration || {}, {
        region: endpointContext.region,
        dedicatedApiHost: endpointContext.dedicatedApiHost,
        endpointMode: endpointContext.endpointMode,
        providerConfigRevision: endpointContext.providerConfigRevision,
        negativePrompt: String(request && request.negativePrompt || ""),
        promptExtend: request && request.promptExtend !== false,
        promptExtendMode: String(request && request.promptExtendMode || "direct"),
        enableThinking: request && request.enableThinking !== false,
        seed: request && request.seed === undefined ? "" : String(request.seed)
      });
      return task;
    }

    getRecoverableTask() {
      var task = this.taskStore && typeof this.taskStore.latest === "function"
        ? this.taskStore.latest(this.id, this.definition.id) : null;
      if (!task) return null;
      return ["PENDING", "RUNNING", "canceled_local", "timed_out", "recovery"].indexOf(task.status) !== -1 ? task : null;
    }

    getImageInputConstraints() {
      return { maxDimension: 2048, maxBytesPerImage: 10 * 1024 * 1024 };
    }

    getHistoryMetadata() {
      return { providerDisplayName: this.displayName, region: this.config.region, endpointMode: this.config.endpointMode,
        dedicatedApiHost: this.config.dedicatedApiHost, providerConfigRevision: this.config.providerConfigRevision };
    }

    getReadOnlyInfo() {
      return {
        providerId: this.id,
        region: this.config.region,
        baseUrl: this.config.baseUrl,
        submitEndpoint: this.definition.submit.endpoint,
        pollEndpoint: this.definition.poll.endpointTemplate,
        generationTimeoutMs: this.definition.poll.timeoutMs
      };
    }

    async poll(task, context) {
      try { return await super.poll(task, context); }
      catch (error) {
        if (error && error.code === ErrorCodes.INVALID_RESPONSE_STATUS && error.details && error.details.status === "UNKNOWN") {
          throw new AppError(ErrorCodes.BAILIAN_TASK_UNAVAILABLE,
            "The Bailian task status is unknown or the task no longer exists.", {
              taskId: task && task.id,
              status: "UNKNOWN",
              provider: this.displayName,
              endpoint: this.definition.poll.endpointTemplate
            });
        }
        if (error && error.code === ErrorCodes.TASK_NOT_FOUND) {
          throw new AppError(ErrorCodes.BAILIAN_TASK_UNAVAILABLE,
            "The Bailian task may have expired or no longer exists.", Object.assign({
              taskId: task && task.id,
              provider: this.displayName,
              endpoint: this.definition.poll.endpointTemplate
            }, error.details || {}));
        }
        throw mapBailianServiceError(error);
      }
    }
  }

  return { AliyunBailianProvider: AliyunBailianProvider };
}));
