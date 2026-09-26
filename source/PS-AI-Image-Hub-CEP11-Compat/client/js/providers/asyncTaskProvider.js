(function defineAsyncTaskProvider(root, factory) {
  "use strict";
  var base = typeof module === "object" && module.exports ? require("./baseProvider") : root.PSAIImageHubCompat;
  var configs = typeof module === "object" && module.exports ? require("./providerConfig") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var definitions = typeof module === "object" && module.exports ? require("./asyncTaskDefinition") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var polling = typeof module === "object" && module.exports ? require("../generation/pollingManager") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var stores = typeof module === "object" && module.exports ? require("../storage/asyncTaskStore") : root.PSAIImageHubCompat;
  var api = factory(base, configs, builders, definitions, errors, polling, logging, stores);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createAsyncTaskProvider(base, configs, builders, definitions, errors, polling, logging, stores) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var SCHEMA_VERSION = definitions.ASYNC_TASK_SCHEMA_VERSION;

  function maskTaskId(value) {
    var text = String(value || "");
    if (text.length <= 10) return text;
    return text.slice(0, 6) + "…" + text.slice(-4);
  }

  function notify(context, name, payload) {
    if (!context || typeof context[name] !== "function") return;
    try { context[name](payload); }
    catch (error) { logging.logger.warn("Async observer failed", { observer: name, message: error && error.message }); }
  }

  function diagnostic(provider, eventName, task, details) {
    var data = Object.assign({
      providerId: provider.id,
      definitionId: provider.definition.id,
      taskId: task && maskTaskId(task.id),
      status: task && task.status
    }, details || {});
    logging.logger.info(eventName, data);
    return data;
  }

  function mapHttpError(error, stage) {
    if (!(error instanceof AppError)) return new AppError(ErrorCodes.NETWORK, error && error.message || "Async network request failed.", { stage: stage });
    var status = Number(error.details && error.details.status) || 0;
    var code = error.code;
    if (status === 401 || status === 403) code = ErrorCodes.AUTH_ERROR;
    else if (status === 404) code = ErrorCodes.TASK_NOT_FOUND;
    else if (status === 408 || error.code === ErrorCodes.NETWORK_TIMEOUT || error.code === ErrorCodes.NETWORK_CONNECTION_TIMEOUT) code = ErrorCodes.REQUEST_TIMEOUT;
    else if (status === 429) code = ErrorCodes.RATE_LIMITED;
    else if (status >= 500) code = ErrorCodes.REMOTE_SERVER_ERROR;
    if (code === error.code) return error;
    return new AppError(code, error.message, Object.assign({ stage: stage }, error.details || {}));
  }

  function isTemporaryPollError(error) {
    if (!error) return false;
    var status = Number(error.details && error.details.status) || 0;
    return [ErrorCodes.NETWORK, ErrorCodes.CORS_ERROR, ErrorCodes.REQUEST_TIMEOUT, ErrorCodes.REMOTE_SERVER_ERROR,
      ErrorCodes.HTTP_SERVER].indexOf(error.code) !== -1 || status === 502 || status === 503;
  }

  function cleanRequestConfiguration(request) {
    var value = request || {};
    return {
      aspectRatio: String(value.aspectRatio || ""),
      count: Number(value.count) || 1,
      resolutionTier: String(value.resolutionTier || value.imageSize || ""),
      replyType: String(value.replyType || "async")
    };
  }

  function imageMetadata(image) {
    if (!image) return null;
    return {
      sourceType: String(image.sourceType || ""), width: Number(image.width) || null, height: Number(image.height) || null,
      bounds: image.bounds || null, documentBounds: image.documentBounds || null
    };
  }

  function recoveryData(request) {
    var set = request && request.imageInputs || {};
    return {
      mainTarget: imageMetadata(set.mainImage),
      referenceImages: (set.referenceImages || []).map(imageMetadata).filter(Boolean)
    };
  }

  function appendQuery(url, query) { return definitions.appendAsyncQuery(url, query || {}); }

  class AsyncTaskProvider extends base.BaseProvider {
    constructor(config, dependencies) {
      var rawConfig = config || {};
      var normalized = configs.normalizeProviderConfig(rawConfig);
      var injected = dependencies || {};
      super({ id: normalized.id, displayName: normalized.displayName, type: normalized.type,
        models: normalized.models,
        capabilities: { supportsTextToImage: true, supportsAspectRatio: true, supportsCustomModels: true, executionMode: "async" } });
      this.executionMode = "async";
      this.config = normalized;
      this.definition = definitions.normalizeAsyncTaskDefinition(injected.definition || rawConfig.asyncTaskDefinition || definitions.createConfigAsyncTaskDefinition(rawConfig));
      this.apiClient = injected.apiClient;
      this.secretStore = injected.secretStore;
      this.pollingManager = injected.pollingManager || new polling.PollingManager();
      this.taskStore = injected.asyncTaskStore || new stores.AsyncTaskStore();
      this.activeTask = null;
    }

    secretName() { return "provider:" + this.id + ":apiKey"; }
    apiKey() { return this.config.authType === "none" ? null : this.secretStore && this.secretStore.get(this.secretName()); }

    validateConfig() {
      var definitionValidation = definitions.validateAsyncTaskDefinition(this.definition);
      var hasSecret = this.config.authType === "none" || Boolean(this.apiKey());
      var configForValidation = Object.assign({}, this.config, {
        responsePath: this.definition.task.idPath,
        pollingEndpoint: this.definition.poll.endpoint || this.definition.poll.endpointTemplate || this.definition.poll.endpointPath,
        pollingResultPath: this.definition.result.path
      });
      var providerValidation = configs.validateProviderConfig(configForValidation, hasSecret);
      var allErrors = providerValidation.errors.concat(definitionValidation.errors);
      return { valid: allErrors.length === 0, errors: allErrors,
        code: definitionValidation.valid ? providerValidation.code : ErrorCodes.INVALID_PROVIDER_CONFIG,
        config: this.config, definition: this.definition };
    }

    testConnection() {
      var validation = this.validateConfig();
      if (!validation.valid) return Promise.reject(new AppError(validation.code, validation.errors[0]));
      return Promise.resolve({ ok: true, mode: "configuration-only", executionMode: "async" });
    }

    builderContext(request, task, response, context) {
      return {
        request: request || null,
        requestBody: context && context.requestBody,
        task: task || null,
        response: response || task && task.submitResponse || null,
        submitResponse: task && task.submitResponse || null,
        apiKey: this.apiKey(),
        config: this.config,
        definition: this.definition,
        context: context || {}
      };
    }

    resolveSectionUrl(section, task, context) {
      var response = task && (task.submitResponse || task.lastResponse);
      var storedUrl = task && (section === this.definition.poll ? task.pollUrl : section === this.definition.cancel ? task.cancelUrl : "");
      var endpoint = storedUrl || "";
      if (!endpoint && section.endpointPath) endpoint = definitions.resolveAsyncPath(response, section.endpointPath);
      if (!endpoint && section.endpointTemplate) endpoint = definitions.applyAsyncTaskTemplate(section.endpointTemplate, task && task.id);
      if (!endpoint) endpoint = definitions.applyAsyncTaskTemplate(section.endpoint, task && task.id);
      if (!endpoint) throw new AppError(ErrorCodes.MISSING_ENDPOINT, "Async request endpoint could not be resolved.");
      var url = definitions.resolveAsyncEndpoint(this.config.baseUrl, endpoint);
      var builderContext = this.builderContext(null, task, response, context);
      var query = typeof section.queryBuilder === "function" ? section.queryBuilder(builderContext) : section.query;
      return appendQuery(url, query);
    }

    buildHttpRequest(section, request, task, context) {
      var response = task && (task.submitResponse || task.lastResponse);
      var builderContext = this.builderContext(request, task, response, context);
      var headers = typeof section.headersBuilder === "function"
        ? section.headersBuilder(builderContext)
        : Object.assign({}, section.headers || builders.buildHeaders(this.config, this.apiKey()));
      var bodyValue = typeof section.bodyBuilder === "function" ? section.bodyBuilder(builderContext) : section.body;
      if (bodyValue === undefined && section === this.definition.submit) bodyValue = builders.renderJsonBody(this.config.requestBodyTemplate, request || {});
      var body = bodyValue === undefined || bodyValue === null ? undefined : typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue);
      return {
        url: this.resolveSectionUrl(section, task, context),
        method: section.method,
        headers: headers,
        body: body,
        timeout: section.requestTimeoutMs,
        timeoutContext: "connection",
        corsAware: true,
        cancellationToken: context && context.cancellationToken,
        diagnostics: {
          stage: section === this.definition.submit ? "asyncSubmit" : section === this.definition.poll ? "asyncPolling" : "asyncCancel",
          provider: this.displayName, endpoint: section.endpoint || section.endpointTemplate || section.endpointPath,
          definitionId: this.definition.id, taskId: task && maskTaskId(task.id)
        }
      };
    }

    async requestSection(section, request, task, context, stage) {
      if (!this.apiClient || typeof this.apiClient.requestJson !== "function") throw new AppError(ErrorCodes.NETWORK, "Async API client is unavailable.");
      try {
        var http = this.buildHttpRequest(section, request, task, context);
        return await this.apiClient.requestJson(http.url, http);
      } catch (error) { throw mapHttpError(error, stage); }
    }

    createTask(submitResponse, request) {
      var taskId = definitions.resolveAsyncPath(submitResponse, this.definition.task.idPath);
      if (taskId === undefined || taskId === null || String(taskId) === "") {
        diagnostic(this, "ASYNC_TASK_ID_MISSING", null, { stage: "submit" });
        throw new AppError(ErrorCodes.INVALID_RESPONSE, "Async submit response does not contain a Task ID.", { reason: "ASYNC_TASK_ID_MISSING" });
      }
      var status = definitions.classifyAsyncStatus(this.definition, submitResponse);
      var task = {
        schemaVersion: SCHEMA_VERSION,
        definitionVersion: this.definition.definitionVersion,
        id: String(taskId), taskId: String(taskId), providerId: this.id,
        protocolId: this.definition.protocolId, definitionId: this.definition.id,
        status: status.value || "task_created", statusKind: status.kind,
        executionId: String(request && request.executionId || ""),
        historyId: String(request && request.historyId || ""),
        modelId: String(request && request.modelId || this.config.modelId || ""),
        prompt: String(request && request.prompt || ""),
        submitResponse: submitResponse, lastResponse: submitResponse,
        pollUrl: this.definition.poll.endpointPath ? String(definitions.resolveAsyncPath(submitResponse, this.definition.poll.endpointPath) || "") : "",
        cancelUrl: this.definition.cancel.endpointPath ? String(definitions.resolveAsyncPath(submitResponse, this.definition.cancel.endpointPath) || "") : "",
        createdAt: new Date().toISOString(), requestConfiguration: cleanRequestConfiguration(request), recoveryData: recoveryData(request)
      };
      return task;
    }

    persistTask(task) {
      this.activeTask = task;
      if (this.taskStore && typeof this.taskStore.save === "function") this.taskStore.save(task);
      return task;
    }

    async submit(request, context) {
      var validation = this.validateConfig();
      if (!validation.valid) throw new AppError(validation.code, validation.errors[0]);
      diagnostic(this, "ASYNC_SUBMIT_START", null, { model: request && request.modelId });
      var response = await this.requestSection(this.definition.submit, request, null, context, "submit");
      if (!response || typeof response !== "object") throw new AppError(ErrorCodes.INVALID_RESPONSE, "Async submit response is malformed.");
      var task = this.persistTask(this.createTask(response, request));
      diagnostic(this, "ASYNC_TASK_CREATED", task);
      notify(context, "onTask", task);
      notify(context, "onStatus", "taskSubmitted");
      return task;
    }

    async queryTask(task, context) {
      var response = await this.requestSection(this.definition.poll, null, task, context, "polling");
      if (!response || typeof response !== "object") throw new AppError(ErrorCodes.INVALID_RESPONSE, "Async polling response is malformed.");
      var status = definitions.classifyAsyncStatus(this.definition, response);
      task.lastResponse = response;
      task.status = status.value || "missing";
      task.statusKind = status.kind;
      if (!task.pollUrl && this.definition.poll.endpointPath) task.pollUrl = String(definitions.resolveAsyncPath(response, this.definition.poll.endpointPath) || "");
      if (!task.cancelUrl && this.definition.cancel.endpointPath) task.cancelUrl = String(definitions.resolveAsyncPath(response, this.definition.cancel.endpointPath) || "");
      this.persistTask(task);
      notify(context, "onTask", task);
      return { response: response, status: status };
    }

    async poll(task, context) {
      var options = context || {};
      var pollCount = 0;
      var unknownCount = 0;
      var startedAt = Date.now();
      diagnostic(this, "ASYNC_POLL_START", task);
      try {
        return await this.pollingManager.poll(async () => {
          pollCount += 1;
          var checked = await this.queryTask(task, options);
          var elapsedMs = Date.now() - startedAt;
          diagnostic(this, "ASYNC_POLL_STATUS", task, { pollCount: pollCount, elapsedMs: elapsedMs, statusKind: checked.status.kind });
          if (checked.status.kind === "missing") {
            throw new AppError(ErrorCodes.INVALID_RESPONSE, "Async polling response is missing status.");
          }
          if (checked.status.kind === "unknown") {
            unknownCount += 1;
            logging.logger.warn("ASYNC_UNKNOWN_STATUS", { providerId: this.id, definitionId: this.definition.id,
              taskId: maskTaskId(task.id), status: checked.status.value, unknownCount: unknownCount });
            if (unknownCount >= this.definition.poll.unknownStatusLimit) {
              throw new AppError(ErrorCodes.INVALID_RESPONSE_STATUS, "Async task repeatedly returned an unknown status.",
                { reason: "ASYNC_UNKNOWN_STATUS", status: checked.status.value, taskId: task.id });
            }
            return { done: false };
          }
          unknownCount = 0;
          if (checked.status.kind === "success") {
            var result = definitions.extractAsyncResult(this.definition, checked.response);
            if (!result.urls.length && !result.base64.length) throw new AppError(ErrorCodes.NO_IMAGES, "Async task succeeded without an image result.");
            diagnostic(this, "ASYNC_POLL_SUCCESS", task, { pollCount: pollCount, elapsedMs: elapsedMs });
            diagnostic(this, "ASYNC_RESULT_EXTRACTED", task, { urlCount: result.urls.length, base64Count: result.base64.length });
            return { done: true, value: checked.response };
          }
          if (checked.status.kind === "failure") {
            var remoteMessage = definitions.extractAsyncErrorMessage(this.definition, checked.response);
            diagnostic(this, "ASYNC_POLL_FAILURE", task, { pollCount: pollCount, elapsedMs: elapsedMs });
            throw new AppError(ErrorCodes.ASYNC_TASK_FAILED, remoteMessage, { taskId: task.id, status: task.status });
          }
          if (checked.status.kind === "canceled") {
            throw new AppError(ErrorCodes.ASYNC_REMOTE_CANCELED, "Remote async task was canceled.", { taskId: task.id, status: task.status });
          }
          notify(options, "onStatus", "generating");
          return { done: false };
        }, {
          interval: this.definition.poll.intervalMs,
          maxAttempts: this.definition.poll.maxAttempts,
          timeoutMs: this.definition.poll.timeoutMs,
          cancellationToken: options.cancellationToken,
          temporaryFailureRetries: this.definition.poll.temporaryFailureRetries,
          shouldRetry: isTemporaryPollError,
          onRetry: (error, attempt, retryCount) => diagnostic(this, "ASYNC_POLL_RETRY", task, {
            pollCount: attempt, retryCount: retryCount, errorCode: error && error.code
          })
        });
      } catch (error) {
        if (error && error.code === ErrorCodes.GENERATION_TIMEOUT) {
          task.status = "timed_out"; this.persistTask(task);
          diagnostic(this, "ASYNC_TIMEOUT", task, { pollCount: pollCount, elapsedMs: Date.now() - startedAt });
          error.details = Object.assign({ taskId: task.id, canRecover: true, definitionId: this.definition.id }, error.details || {});
        } else if (error && error.code === ErrorCodes.CANCELLED) {
          task.status = "canceled_local"; this.persistTask(task);
          diagnostic(this, "ASYNC_LOCAL_CANCEL", task, { pollCount: pollCount, elapsedMs: Date.now() - startedAt });
          error.details = Object.assign({ taskId: task.id, localOnly: true, canRecover: true }, error.details || {});
        }
        throw error;
      }
    }

    terminalSubmitResult(task) {
      if (task.statusKind === "success") return task.submitResponse;
      if (task.statusKind === "failure") throw new AppError(ErrorCodes.ASYNC_TASK_FAILED,
        definitions.extractAsyncErrorMessage(this.definition, task.submitResponse), { taskId: task.id, status: task.status });
      if (task.statusKind === "canceled") throw new AppError(ErrorCodes.ASYNC_REMOTE_CANCELED, "Remote async task was canceled.", { taskId: task.id });
      return null;
    }

    async generate(request, context) {
      var task = await this.submit(request, context);
      var immediate = this.terminalSubmitResult(task);
      if (immediate) return immediate;
      return this.poll(task, context);
    }

    loadRecoveryTask(taskOrId) {
      if (taskOrId && typeof taskOrId === "object") return Object.assign({}, taskOrId);
      var id = String(taskOrId || "");
      var saved = this.taskStore && typeof this.taskStore.load === "function"
        ? this.taskStore.load(id, this.id, this.definition.id)
        : null;
      return saved || { schemaVersion: SCHEMA_VERSION, definitionVersion: this.definition.definitionVersion,
        id: id, taskId: id, providerId: this.id, protocolId: this.definition.protocolId,
        definitionId: this.definition.id, status: "recovery", createdAt: new Date().toISOString() };
    }

    async recoverTask(taskOrId, context) {
      var task = this.loadRecoveryTask(taskOrId);
      if (!task.id) throw new AppError(ErrorCodes.TASK_ID_UNAVAILABLE, "Task recovery requires a Task ID.");
      if (Number(task.schemaVersion) !== SCHEMA_VERSION || Number(task.definitionVersion) !== Number(this.definition.definitionVersion) ||
          task.definitionId && task.definitionId !== this.definition.id) {
        throw new AppError(ErrorCodes.RECOVERY_SCHEMA_UNSUPPORTED, "Saved async task uses an unsupported recovery schema.",
          { taskId: task.id, definitionId: task.definitionId, definitionVersion: task.definitionVersion });
      }
      task.submitResponse = null; task.lastResponse = null;
      this.persistTask(task);
      diagnostic(this, "ASYNC_RECOVERY_START", task);
      return this.poll(task, context || {});
    }

    async cancel(taskOrId, options) {
      var settings = options || {};
      var task = taskOrId ? this.loadRecoveryTask(taskOrId) : this.activeTask;
      if (!task || !task.id) return { canceledLocally: false, canceledRemotely: false };
      if (settings.cancellationToken && typeof settings.cancellationToken.cancel === "function") settings.cancellationToken.cancel();
      task.status = "canceled_local"; this.persistTask(task);
      diagnostic(this, "ASYNC_LOCAL_CANCEL", task);
      if (!settings.remote || !this.definition.cancel.supported) {
        return { task: task, canceledLocally: true, canceledRemotely: false, serverMayContinue: true };
      }
      diagnostic(this, "ASYNC_REMOTE_CANCEL_START", task);
      try {
        await this.requestSection(this.definition.cancel, null, task, Object.assign({}, settings, { cancellationToken: null }), "cancel");
        task.status = "canceled_remote"; this.persistTask(task);
        diagnostic(this, "ASYNC_REMOTE_CANCEL_SUCCESS", task);
        return { task: task, canceledLocally: true, canceledRemotely: true, serverMayContinue: false };
      } catch (error) {
        diagnostic(this, "ASYNC_REMOTE_CANCEL_FAILURE", task, { errorCode: error && error.code });
        return { task: task, canceledLocally: true, canceledRemotely: false, remoteCancelFailed: true,
          serverMayContinue: true, error: error };
      }
    }

    parseResponse(response) {
      var status = definitions.classifyAsyncStatus(this.definition, response);
      return { id: definitions.resolveAsyncPath(response, this.definition.task.idPath), status: status.value,
        statusKind: status.kind, result: definitions.extractAsyncResult(this.definition, response), raw: response };
    }

    extractImages(parsed) {
      var normalized = parsed && parsed.result ? parsed.result : definitions.extractAsyncResult(this.definition, parsed && parsed.raw || parsed);
      var mimeType = this.definition.result.mimeType || "image/png";
      var images = normalized.urls.map(function url(value, index) {
        return { id: "async-url-" + index, mimeType: mimeType, previewSource: value,
          importSource: { type: "url", url: value }, rawResponseMeta: { definitionId: this.definition.id, resultPath: this.definition.result.path } };
      }, this);
      return images.concat(normalized.base64.map(function base64(value, index) {
        var dataUrl = /^data:/i.test(value) ? value : "data:" + mimeType + ";base64," + value;
        return { id: "async-base64-" + index, mimeType: mimeType, previewSource: dataUrl,
          importSource: { type: "base64", data: value, mimeType: mimeType }, rawResponseMeta: { definitionId: this.definition.id, resultPath: this.definition.result.path } };
      }, this));
    }
  }

  return {
    AsyncTaskProvider: AsyncTaskProvider,
    mapAsyncHttpError: mapHttpError,
    isTemporaryAsyncPollError: isTemporaryPollError
  };
}));
