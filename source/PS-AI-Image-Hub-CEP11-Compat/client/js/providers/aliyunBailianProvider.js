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

  function maskedWorkspace(value) {
    var text = String(value || "");
    if (text.length <= 8) return text ? text.slice(0, 2) + "…" : "";
    return text.slice(0, 4) + "…" + text.slice(-4);
  }

  function maskedEndpoint(value, workspaceId) {
    var endpoint = String(value || "");
    var workspace = String(workspaceId || "");
    return workspace ? endpoint.split(workspace).join(maskedWorkspace(workspace)) : endpoint;
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
      if (!this.config.workspaceId) {
        issues.push("Alibaba Cloud Model Studio requires a Workspace ID.");
        if (code === ErrorCodes.INVALID_PROVIDER_CONFIG) code = ErrorCodes.BAILIAN_WORKSPACE_REQUIRED;
      }
      else if (!catalog.isSafeAliyunWorkspaceId(this.config.workspaceId)) issues.push("Workspace ID cannot be used safely in the regional host name.");
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
      return super.submit(request, context);
    }

    endpointContext(request, task) {
      var requestMetadata = request && request.providerMetadata || {};
      var saved = task && task.requestConfiguration || {};
      return {
        region: String(saved.region || requestMetadata.region || this.config.region || ""),
        workspaceId: String(saved.workspaceId || requestMetadata.workspaceId || this.config.workspaceId || "")
      };
    }

    buildHttpRequest(section, request, task, context) {
      var http = super.buildHttpRequest(section, request, task, context);
      var endpointContext = this.endpointContext(request, task);
      var isSubmit = section === this.definition.submit;
      var isPoll = section === this.definition.poll;
      if (isSubmit) http.url = catalog.buildBailianSubmitUrl(endpointContext.workspaceId, endpointContext.region);
      else if (isPoll) http.url = task && task.pollUrl || catalog.buildBailianPollUrl(endpointContext.workspaceId, endpointContext.region, task && task.id);
      var submitEndpoint = catalog.buildBailianSubmitUrl(endpointContext.workspaceId, endpointContext.region);
      var pollEndpoint = task && task.id
        ? catalog.buildBailianPollUrl(endpointContext.workspaceId, endpointContext.region, task.id)
        : catalog.resolveAliyunBailianBaseUrl(endpointContext.region, endpointContext.workspaceId) + "/api/v1/tasks/{taskId}";
      var safeSubmitEndpoint = maskedEndpoint(submitEndpoint, endpointContext.workspaceId);
      var safePollEndpoint = maskedEndpoint(pollEndpoint, endpointContext.workspaceId);
      http.diagnostics = Object.assign({}, http.diagnostics || {}, {
        provider: this.id,
        model: request && request.modelId || task && task.modelId || this.config.modelId,
        workspaceId: maskedWorkspace(endpointContext.workspaceId),
        region: endpointContext.region,
        submitEndpoint: safeSubmitEndpoint,
        pollEndpoint: safePollEndpoint
      });
      logging.logger.info("BAILIAN_REQUEST_CONFIGURED", {
        stage: isSubmit ? "submit" : isPoll ? "polling" : "other",
        provider: this.id,
        model: http.diagnostics.model,
        workspaceId: http.diagnostics.workspaceId,
        region: endpointContext.region,
        submitEndpoint: safeSubmitEndpoint,
        pollEndpoint: safePollEndpoint
      });
      return http;
    }

    createTask(submitResponse, request) {
      var task = super.createTask(submitResponse, request);
      var endpointContext = this.endpointContext(request, null);
      task.pollUrl = catalog.buildBailianPollUrl(endpointContext.workspaceId, endpointContext.region, task.id);
      task.requestConfiguration = Object.assign({}, task.requestConfiguration || {}, {
        region: endpointContext.region,
        workspaceId: endpointContext.workspaceId,
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
      return { providerDisplayName: this.displayName, region: this.config.region, workspaceId: this.config.workspaceId };
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
        throw error;
      }
    }
  }

  return { AliyunBailianProvider: AliyunBailianProvider };
}));
