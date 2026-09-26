(function defineGenerationManager(root, factory) {
  "use strict";
  var requestBuilder = typeof module === "object" && module.exports ? require("./requestBuilder") : root.PSAIImageHubCompat;
  var extractor = typeof module === "object" && module.exports ? require("./responseExtractor") : root.PSAIImageHubCompat;
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var logging = typeof module === "object" && module.exports ? require("../utils/logger") : root.PSAIImageHubCompat;
  var cancellation = typeof module === "object" && module.exports ? require("./cancellationToken") : root.PSAIImageHubCompat;
  var imagePayload = typeof module === "object" && module.exports ? require("./imagePayloadOptimizer") : root.PSAIImageHubCompat;
  var api = factory(requestBuilder, extractor, errors, logging, cancellation, imagePayload);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGenerationManager(requestBuilder, extractor, errors, logging, cancellation, imagePayload) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var toUserMessage = errors.toUserMessage;
  var executionSequence = 0;

  function uniqueId(prefix) {
    executionSequence += 1;
    return prefix + "-" + Date.now() + "-" + executionSequence + "-" + Math.floor(Math.random() * 100000);
  }

  function isolateStatusObserver(observer, label) {
    return function safeStatus(status, payload) {
      if (typeof observer !== "function") return;
      try { observer(status, payload); }
      catch (observerError) { logging.logger.warn(label || "Generation status observer failed", { status: status, message: observerError && observerError.message }); }
    };
  }

  function inputTimingTotal(inputSet, name) {
    var ordered = [];
    if (inputSet && inputSet.mainImage) ordered.push(inputSet.mainImage);
    if (inputSet && Array.isArray(inputSet.referenceImages)) ordered = ordered.concat(inputSet.referenceImages);
    return ordered.reduce(function sum(total, image) { return total + (Number(image && image.timings && image.timings[name]) || 0); }, 0);
  }

  function imageImportTarget(mainImage) {
    if (!mainImage) return null;
    function copyBounds(value) {
      if (!value) return null;
      var left = Number(value.left), top = Number(value.top), width = Number(value.width), height = Number(value.height);
      if (!(isFinite(left) && isFinite(top) && width > 0 && height > 0)) return null;
      return { left: left, top: top, right: isFinite(Number(value.right)) ? Number(value.right) : left + width,
        bottom: isFinite(Number(value.bottom)) ? Number(value.bottom) : top + height, width: width, height: height };
    }
    return { sourceType: String(mainImage.sourceType || "local-image"), bounds: copyBounds(mainImage.bounds),
      documentBounds: copyBounds(mainImage.documentBounds), width: Number(mainImage.width) || null, height: Number(mainImage.height) || null };
  }

  function findProviderModel(provider, modelId) {
    if (!provider) return null;
    if (typeof provider.getModel === "function") return provider.getModel(modelId);
    var models = typeof provider.getModels === "function" ? provider.getModels() : [];
    for (var index = 0; index < models.length; index += 1) {
      if (models[index] && models[index].id === modelId) return models[index];
    }
    return null;
  }

  class GenerationManager {
    constructor(dependencies) {
      this.providerManager = dependencies.providerManager;
      this.imageImporter = dependencies.imageImporter;
      this.t = dependencies.t;
      this.responseExtractor = dependencies.responseExtractor || new extractor.ResponseExtractor();
      this.imagePayloadOptimizer = dependencies.imagePayloadOptimizer || new imagePayload.ImagePayloadOptimizer();
      this.historyStore = dependencies.historyStore || null;
      this.recoveryStore = dependencies.recoveryStore || null;
      this.running = false;
      this.currentCancellationToken = null;
      this.sessions = {};
      this.activeGenerationSessionId = null;
      this.currentInteractiveSessionId = null;
    }

    createExecution(input, existing) {
      var source = existing || {};
      var execution = {
        executionId: String(source.executionId || uniqueId("execution")),
        historyId: String(source.historyId || uniqueId("history")),
        taskId: String(source.taskId || ""),
        createdAt: String(source.createdAt || new Date().toISOString())
      };
      logging.logger.info("ASYNC_EXECUTION_CREATED", execution);
      if (input && input.snapshotSourceExecutionId) {
        logging.logger.info("ASYNC_SNAPSHOT_REGENERATION_STARTED", {
          sourceExecutionId: String(input.snapshotSourceExecutionId), newExecutionId: execution.executionId,
          historyId: execution.historyId
        });
      }
      if (this.historyStore && typeof this.historyStore.beginExecution === "function") {
        try { this.historyStore.beginExecution(input || {}, execution); }
        catch (error) { logging.logger.warn("Generation history start write failed", { message: error && error.message }); }
      }
      return execution;
    }

    startSession(kind, execution) {
      var session = {
        id: uniqueId("session"), kind: kind, execution: execution,
        cancellationToken: new cancellation.CancellationToken(), active: true
      };
      this.sessions[session.id] = session;
      this.running = true;
      this.currentInteractiveSessionId = session.id;
      this.currentCancellationToken = session.cancellationToken;
      if (kind === "generation") {
        this.activeGenerationSessionId = session.id;
      }
      return session;
    }

    finishSession(session) {
      if (!session) return;
      session.active = false;
      delete this.sessions[session.id];
      if (this.activeGenerationSessionId === session.id) {
        this.activeGenerationSessionId = null;
      }
      if (this.currentInteractiveSessionId === session.id) {
        var remainingIds = Object.keys(this.sessions);
        this.currentInteractiveSessionId = remainingIds.length ? remainingIds[remainingIds.length - 1] : null;
        this.currentCancellationToken = this.currentInteractiveSessionId
          ? this.sessions[this.currentInteractiveSessionId].cancellationToken : null;
      }
      this.running = Object.keys(this.sessions).length > 0;
    }

    sessionStatusObserver(observer, session, label) {
      var safeObserver = isolateStatusObserver(observer, label);
      return (status, payload) => {
        if (!session.active || session.cancellationToken.cancelled && status !== "cancelled") {
          logging.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
            executionId: session.execution.executionId, historyId: session.execution.historyId,
            sessionId: session.id, callbackStatus: status
          });
          return;
        }
        safeObserver(status, Object.assign({}, payload || {}, {
          executionId: session.execution.executionId, historyId: session.execution.historyId,
          sessionId: session.id
        }));
      };
    }

    persistTaskOwnership(provider, state, execution) {
      if (!state || !state.id) return;
      execution.taskId = String(state.id);
      if (provider && provider.taskStore && typeof provider.taskStore.save === "function") {
        try {
          provider.taskStore.save(Object.assign({}, state, {
            executionId: execution.executionId, historyId: execution.historyId,
            modelId: state.modelId || provider.config && provider.config.modelId,
            node: provider.config && provider.config.node,
            baseUrl: provider.config && provider.config.baseUrl
          }));
        } catch (error) { logging.logger.warn("Task ownership persistence failed", { message: error && error.message }); }
      }
      if (this.historyStore && typeof this.historyStore.writeExecutionStatus === "function") {
        try { this.historyStore.writeExecutionStatus(execution, { status: "running", generationStatus: "running", taskId: execution.taskId }); }
        catch (error) { logging.logger.warn("Generation history task write failed", { message: error && error.message }); }
      }
    }

    validateInput(input) {
      if (!input.providerId) throw new AppError(ErrorCodes.PROVIDER_REQUIRED, "Provider is required.");
      if (!input.modelId) throw new AppError(ErrorCodes.MODEL_REQUIRED, "Model is required.");
      if (!input.prompt || !input.prompt.trim()) throw new AppError(ErrorCodes.PROMPT_REQUIRED, "Prompt is required.");
    }

    async generateOneClick(input, callbacks) {
      if (this.activeGenerationSessionId) return null;
      var execution = this.createExecution(input);
      var session = this.startSession("generation", execution);
      var onStatus = this.sessionStatusObserver(callbacks && callbacks.onStatus, session, "Generation status observer failed");
      var cancellationToken = session.cancellationToken;
      if (callbacks && typeof callbacks.onExecution === "function") callbacks.onExecution(Object.assign({}, execution));
      var totalStartedAt = Date.now();
      var pipelineTimings = { exportMs: 0, readMs: 0, optimizeMs: 0, encodeMs: 0, serializeMs: 0,
        requestPayloadBytes: 0, requestRoundTripBeforeTaskMs: 0, taskWaitMs: 0, downloadMs: 0, importMs: 0, totalMs: 0 };
      onStatus("validating");
      try {
        this.validateInput(input);
        var provider = this.providerManager.requireProvider(input.providerId);
        var modelExists = provider.getModels().some(function match(model) { return model.id === input.modelId; });
        if (!modelExists) {
          throw new AppError(ErrorCodes.MODEL_REQUIRED, "Model not found for provider " + provider.id + ": " + input.modelId);
        }
        var configResult = provider.validateConfig(input.providerConfig || {});
        if (!configResult || configResult.valid !== true) {
          throw new AppError(configResult && configResult.code || ErrorCodes.INVALID_PROVIDER_CONFIG, configResult && configResult.errors && configResult.errors[0] || "Provider configuration is invalid.");
        }
        var preparedInput = Object.assign({}, input);
        preparedInput.finalPrompt = String(input.prompt || input.finalPrompt || "").trim();
        preparedInput.prompt = preparedInput.finalPrompt;
        var selectedModel = findProviderModel(provider, input.modelId);
        preparedInput.providerDisplayName = provider.displayName;
        preparedInput.modelDisplayName = selectedModel && selectedModel.displayName || input.modelId;
        if (typeof provider.getHistoryMetadata === "function") {
          preparedInput.providerMetadata = provider.getHistoryMetadata();
        }
        if (cancellationToken.cancelled) throw new AppError(ErrorCodes.CANCELLED, "Generation was cancelled before image submission.");
        var request = requestBuilder.buildGenerationRequest(preparedInput);
        request.providerMetadata = preparedInput.providerMetadata || null;
        request.executionId = execution.executionId;
        request.historyId = execution.historyId;
        var mainTarget = imageImportTarget(preparedInput.imageInputs && preparedInput.imageInputs.mainImage);
        var hasMainImage = Boolean(request.imageInputs && request.imageInputs.mainImage);
        var referenceCount = request.imageInputs && request.imageInputs.referenceImages ? request.imageInputs.referenceImages.length : 0;
        if (hasMainImage || referenceCount) {
          pipelineTimings.exportMs = inputTimingTotal(request.imageInputs, "exportMs");
          pipelineTimings.readMs = inputTimingTotal(request.imageInputs, "readMs");
          pipelineTimings.encodeMs = inputTimingTotal(request.imageInputs, "encodeMs");
          logging.logImagePipeline(4, "IMAGE_INPUT_SET_READY", { hasMainImage: hasMainImage, referenceCount: referenceCount });
          logging.logImagePipeline(4, "IMAGE_PREPARE_STARTED", { mainImageCount: hasMainImage ? 1 : 0, referenceCount: referenceCount,
            exportMs: pipelineTimings.exportMs, readMs: pipelineTimings.readMs });
          onStatus("preparingImages", { mainImageCount: hasMainImage ? 1 : 0, referenceCount: referenceCount });
          var inputConstraints = typeof provider.getImageInputConstraints === "function"
            ? provider.getImageInputConstraints(request.modelId) : null;
          var optimized = await this.imagePayloadOptimizer.optimize(request.imageInputs, inputConstraints);
          request.imageInputs = optimized.imageInputs;
          request.mainImage = optimized.imageInputs.mainImage;
          request.referenceImages = optimized.imageInputs.referenceImages.slice();
          request.references = (request.mainImage ? [request.mainImage] : []).concat(request.referenceImages);
          request.imageOptimization = optimized.metrics;
          pipelineTimings.optimizeMs = optimized.metrics.optimizeMs;
          pipelineTimings.encodeMs += optimized.metrics.encodeMs;
          logging.logImagePipeline(4, "IMAGE_PREPARE_DONE", optimized.metrics);
          onStatus("imagesPrepared", optimized.metrics);
        }
        onStatus("submitting");
        var taskState = null;
        var rawResponse = await provider.generate(request, {
          onStatus: onStatus,
          cancellationToken: cancellationToken,
          onTask: (state) => {
            if (!session.active) {
              logging.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
                executionId: execution.executionId, historyId: execution.historyId, callbackStatus: "task"
              });
              return;
            }
            taskState = Object.assign({}, state || {}, { executionId: execution.executionId, historyId: execution.historyId });
            this.persistTaskOwnership(provider, taskState, execution);
            if (this.recoveryStore && state && state.id) {
              try {
                var info = typeof provider.getReadOnlyInfo === "function" ? provider.getReadOnlyInfo() : {};
                var historyMetadata = typeof provider.getHistoryMetadata === "function" ? provider.getHistoryMetadata() : {};
                this.recoveryStore.saveSnapshot(state.id, Object.assign({}, request, {
                  providerId: provider.id, node: provider.config && provider.config.node, baseUrl: info.baseUrl || provider.config && provider.config.baseUrl,
                   region: historyMetadata.region || "", workspaceId: historyMetadata.workspaceId || "",
                   executionId: execution.executionId, historyId: execution.historyId,
                   matchMainSize: input.matchMainSize === true,
                   mainTarget: mainTarget,
                   mainTargetDimensions: mainTarget ? { width: mainTarget.width, height: mainTarget.height } : null
                }));
              } catch (snapshotError) { logging.logger.warn("Task recovery snapshot write failed", { message: snapshotError && snapshotError.message }); }
            }
          },
          onDiagnostic: function collectDiagnostic(eventName, values) {
            var details = values || {};
            ["serializeMs", "requestPayloadBytes", "requestRoundTripBeforeTaskMs", "taskWaitMs"].forEach(function copy(name) {
              if (details[name] !== undefined) pipelineTimings[name] = Number(details[name]) || 0;
            });
          }
        });
        if (cancellationToken.cancelled) throw new AppError(ErrorCodes.CANCELLED, "Generation was cancelled.");
        if (provider.id === "grs") onStatus("fetchingResult", taskState && { taskId: taskState.id, progress: taskState.progress });
        var extracted = await this.responseExtractor.extract(provider, rawResponse);
        var result = {
          providerId: provider.id,
          modelId: request.modelId,
          prompt: request.prompt,
          images: extracted.images,
          importState: "notImported",
          importResult: null,
          importError: null,
          taskId: taskState && taskState.id || null,
          executionId: execution.executionId,
          historyId: execution.historyId,
          references: request.references,
          importOptions: { matchMainSize: Boolean(mainTarget) && input.matchMainSize === true,
            mainTarget: mainTarget, mainDimensions: mainTarget ? { width: mainTarget.width, height: mainTarget.height } : null }
        };
        result.pipelineDiagnostics = { imageOptimization: request.imageOptimization || null, timings: pipelineTimings };
        result.rawResponseMeta = extracted.images[0] && extracted.images[0].rawResponseMeta || null;
        onStatus("completed", result);
        if (input.autoImport) {
          try { await this.importGeneratedResult(result, { onStatus: onStatus, cancellationToken: cancellationToken, pipelineTimings: pipelineTimings }); }
          catch (importError) {
            // Generation succeeded. The result and preview remain available for a manual retry.
          }
        }
        if (this.historyStore) {
          try { await this.historyStore.recordSuccess(preparedInput, result, execution); }
          catch (historyError) { logging.logger.warn("Generation history write failed", { message: historyError && historyError.message }); }
        }
        pipelineTimings.totalMs = Date.now() - totalStartedAt;
        logging.logImagePipeline(10, "GENERATION_PIPELINE_DONE", pipelineTimings);
        return result;
      } catch (error) {
        var normalized = error instanceof AppError
          ? error
          : new AppError(ErrorCodes.UNKNOWN, error && error.message || "Unknown generation error.");
        if (typeof provider !== "undefined" && provider && provider.id === "grs") {
          var grsInfo = typeof provider.getReadOnlyInfo === "function" ? provider.getReadOnlyInfo() : {};
          normalized.details = Object.assign({ stage: "response", provider: "GRS",
            model: typeof request !== "undefined" && request && request.modelId || input.modelId,
            endpoint: grsInfo.endpoint || "/v1/api/generate", effectiveTimeoutMs: grsInfo.generationTimeoutMs || 600000 }, normalized.details || {});
        }
        if (!execution.taskId && normalized.details && normalized.details.taskId) execution.taskId = String(normalized.details.taskId);
        if (this.historyStore) {
          try { this.historyStore.recordFailure(input, normalized, execution); }
          catch (historyError) { logging.logger.warn("Generation failure history write failed", { message: historyError && historyError.message }); }
        }
        logging.logger.error("Generation pipeline failed", normalized);
        pipelineTimings.totalMs = Date.now() - totalStartedAt;
        logging.logImagePipeline(10, "GENERATION_PIPELINE_FAILED", pipelineTimings);
        onStatus(normalized.code === ErrorCodes.CANCELLED ? "cancelled" : "failed", { error: normalized, message: toUserMessage(normalized, this.t) });
        throw normalized;
      } finally {
        this.finishSession(session);
      }
    }

    cancelGeneration() {
      var session = this.currentInteractiveSessionId && this.sessions[this.currentInteractiveSessionId];
      if (!session) return false;
      session.cancellationToken.cancel();
      return true;
    }

    async recoverProviderTask(providerId, taskId, options) {
      var settings = options || {};
      var provider = this.providerManager.requireProvider(providerId);
      if (!provider || typeof provider.recoverTask !== "function") throw new AppError(ErrorCodes.INVALID_PROVIDER, "API service does not support task recovery.");
      var savedTask = null;
      try {
        savedTask = provider.taskStore && typeof provider.taskStore.load === "function"
          ? provider.taskStore.load(taskId, providerId, provider.definition && provider.definition.id) : null;
      } catch (error) { savedTask = null; }
      var owner = {
        executionId: String(settings.executionId || savedTask && savedTask.executionId || ""),
        historyId: String(settings.historyId || savedTask && savedTask.historyId || ""),
        taskId: String(taskId || ""),
        createdAt: String(settings.createdAt || savedTask && savedTask.createdAt || new Date().toISOString())
      };
      var recoveryMetadata = typeof provider.getHistoryMetadata === "function" ? provider.getHistoryMetadata() : {};
      var savedConfiguration = savedTask && savedTask.requestConfiguration || {};
      if (savedConfiguration.region) recoveryMetadata.region = String(savedConfiguration.region);
      if (savedConfiguration.workspaceId) recoveryMetadata.workspaceId = String(savedConfiguration.workspaceId);
      var recoveryInput = {
        providerId: providerId, modelId: settings.modelId || provider.config.modelId,
        prompt: settings.finalPrompt || settings.prompt || "",
        finalPrompt: settings.finalPrompt || settings.prompt || "",
        aspectRatio: settings.aspectRatio,
        imageSize: settings.imageSize, imageInputs: settings.imageInputs || null,
        negativePrompt: settings.negativePrompt || "", promptExtend: settings.promptExtend,
        promptExtendMode: settings.promptExtendMode, enableThinking: settings.enableThinking, seed: settings.seed,
        providerDisplayName: provider.displayName,
        modelDisplayName: (findProviderModel(provider, settings.modelId || provider.config.modelId) || {}).displayName,
        providerMetadata: recoveryMetadata
      };
      var execution;
      if (owner.executionId && owner.historyId) {
        execution = owner;
        if (this.historyStore && typeof this.historyStore.beginExecution === "function") {
          try { this.historyStore.beginExecution(recoveryInput, Object.assign({ status: "recovering" }, execution)); }
          catch (error) { logging.logger.warn("Recovery history start write failed", { message: error && error.message }); }
        }
      } else {
        execution = this.createExecution(recoveryInput, owner);
      }
      var session = this.startSession("recovery", execution);
      var onStatus = this.sessionStatusObserver(settings.onStatus, session, "Task recovery status observer failed");
      if (typeof settings.onExecution === "function") settings.onExecution(Object.assign({}, execution));
      logging.logger.info("ASYNC_RECOVERY_SESSION_STARTED", {
        executionId: execution.executionId, historyId: execution.historyId, taskId: execution.taskId,
        sessionId: session.id
      });
      try {
        var raw = await provider.recoverTask(taskId, {
          onStatus: onStatus, cancellationToken: session.cancellationToken, modelId: settings.modelId,
          executionId: execution.executionId, historyId: execution.historyId,
          onTask: (state) => {
            if (!session.active) {
              logging.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
                executionId: execution.executionId, historyId: execution.historyId, callbackStatus: "recovery-task"
              });
              return;
            }
            this.persistTaskOwnership(provider, Object.assign({}, state || {}, {
              id: state && state.id || taskId, executionId: execution.executionId, historyId: execution.historyId
            }), execution);
          }
        });
        onStatus("fetchingResult", { taskId: taskId });
        var extracted = await this.responseExtractor.extract(provider, raw);
        var result = { providerId: providerId, modelId: settings.modelId || provider.config.modelId, prompt: settings.prompt || "",
          images: extracted.images, importState: "notImported", importResult: null, importError: null, taskId: taskId,
          executionId: execution.executionId, historyId: execution.historyId, references: [],
          importOptions: settings.importOptions || { matchMainSize: false, mainDimensions: null } };
        onStatus("completed", result);
        if (settings.autoImport) {
          try { await this.importGeneratedResult(result, { onStatus: onStatus, cancellationToken: session.cancellationToken }); }
          catch (importError) { /* Remote generation succeeded; History keeps generation success and import failure separately. */ }
        }
        if (this.historyStore) {
          try { await this.historyStore.recordSuccess(recoveryInput, result, execution); }
          catch (historyError) { logging.logger.warn("Recovery history success write failed", { message: historyError && historyError.message }); }
        }
        return result;
      } catch (error) {
        var normalized = error instanceof AppError ? error : new AppError(ErrorCodes.UNKNOWN, error && error.message || "Task recovery failed.");
        if (this.historyStore) {
          try { this.historyStore.recordFailure(recoveryInput, normalized, execution); }
          catch (historyError) { logging.logger.warn("Recovery history failure write failed", { message: historyError && historyError.message }); }
        }
        onStatus(normalized.code === ErrorCodes.CANCELLED ? "cancelled" : "failed", { error: normalized, message: toUserMessage(normalized, this.t) });
        throw normalized;
      } finally { this.finishSession(session); }
    }

    async importGeneratedResult(result, callbacks) {
      var onStatus = isolateStatusObserver(callbacks && callbacks.onStatus, "Import status observer failed");
      if (!result || !Array.isArray(result.images) || result.images.length === 0) {
        throw new AppError(ErrorCodes.MISSING_GENERATED_RESULT, "No generated result is available for import.");
      }
      if (!this.imageImporter || typeof this.imageImporter.importImages !== "function") {
        throw new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "Photoshop image importer is unavailable.");
      }
      if (result.importState === "imported") {
        throw new AppError(ErrorCodes.RESULT_ALREADY_IMPORTED, "Generated result was already imported.");
      }
      if (result.importState === "importing") {
        throw new AppError(ErrorCodes.IMPORT_IN_PROGRESS, "Generated result import is already running.");
      }

      result.importState = "importing";
      result.importError = null;
      var importStartedAt = Date.now();
      var downloadMs = 0;
      var progressAware = this.imageImporter.supportsProgressCallbacks === true;
      if (!progressAware) onStatus("importing", { result: result });
      try {
        result.importResult = await this.imageImporter.importImages(result.images, {
          cancellationToken: callbacks && callbacks.cancellationToken,
          matchMainSize: Boolean(result.importOptions && result.importOptions.matchMainSize),
          mainTarget: result.importOptions && result.importOptions.mainTarget,
          mainDimensions: result.importOptions && result.importOptions.mainDimensions,
          historyReimportUsedSavedContext: Boolean(result.importOptions && result.importOptions.historyReimportUsedSavedContext),
          currentDocumentMatchesSavedImportContext: result.importOptions && result.importOptions.currentDocumentMatchesSavedImportContext,
          onStatus: function importStatus(status, payload) { onStatus(status, Object.assign({ result: result }, payload || {})); },
          onDiagnostic: function importDiagnostic(eventName, details) {
            if (eventName === "RESULT_DOWNLOAD_DONE") downloadMs += Number(details && details.downloadMs) || 0;
            logging.logImagePipeline(9, eventName, details || {});
          }
        });
        if (!result.importResult || result.importResult.imported !== true) {
          throw new AppError(ErrorCodes.PHOTOSHOP_IMPORT, "Image importer did not confirm a successful import.");
        }
        result.importState = "imported";
        var importMs = Math.max(0, Date.now() - importStartedAt - downloadMs);
        if (callbacks && callbacks.pipelineTimings) {
          callbacks.pipelineTimings.downloadMs += downloadMs;
          callbacks.pipelineTimings.importMs += importMs;
        }
        logging.logImagePipeline(9, "PHOTOSHOP_IMPORT_DONE", { downloadMs: downloadMs, importMs: importMs });
        if (this.historyStore && result.historyId && typeof this.historyStore.markImported === "function") {
          try { this.historyStore.markImported(result.historyId, result.importResult.importContext); }
          catch (historyError) { logging.logger.warn("History import context write failed", { message: historyError && historyError.message }); }
        }
        onStatus("imported", { result: result });
        return result.importResult;
      } catch (error) {
        var normalized = error instanceof AppError
          ? error
          : new AppError(ErrorCodes.PHOTOSHOP_IMPORT, error && error.message || "Photoshop image import failed.");
        if (result.providerId === "grs") {
          var isDownloadError = [ErrorCodes.IMAGE_DOWNLOAD_FAILED, ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT, ErrorCodes.CORS_ERROR,
            ErrorCodes.HTTP_ERROR, ErrorCodes.HTTP_CLIENT, ErrorCodes.HTTP_SERVER, ErrorCodes.UNSUPPORTED_RESULT_FORMAT,
            ErrorCodes.UNSUPPORTED_IMAGE_FILE].indexOf(normalized.code) !== -1;
          normalized.details = Object.assign({ stage: isDownloadError ? "download" : "import", provider: "GRS",
            model: result.modelId, endpoint: isDownloadError ? "results[0].url" : "PhotoshopBridge.importImage",
            effectiveTimeoutMs: isDownloadError ? 60000 : null }, normalized.details || {});
        }
        result.importState = "failed";
        result.importError = normalized;
        logging.logger.error("Generated image import failed", normalized);
        onStatus("importFailed", {
          result: result,
          error: normalized,
          message: toUserMessage(normalized, this.t)
        });
        throw normalized;
      }
    }
  }

  return { GenerationManager: GenerationManager, createMainImportTarget: imageImportTarget };
}));
