(function definePollingManager(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPollingManager(errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;

  function wait(milliseconds) {
    return new Promise(function resolveLater(resolve) { setTimeout(resolve, milliseconds); });
  }

  function assertNotCancelled(token) {
    if (token && token.cancelled) throw new AppError(ErrorCodes.CANCELLED, "Polling was cancelled.");
  }

  class PollingManager {
    constructor(options) {
      var settings = options || {};
      this.now = settings.now || function currentTime() { return Date.now(); };
      this.wait = settings.wait || wait;
    }
    async poll(checkTask, options) {
      var settings = options || {};
      var interval = settings.interval === undefined ? 1500 : Math.max(0, Number(settings.interval) || 0);
      var maxAttempts = settings.maxAttempts === undefined ? 201 : Math.max(1, Number(settings.maxAttempts) || 1);
      var timeoutMs = settings.timeoutMs === undefined ? 600000 : Math.max(1, Number(settings.timeoutMs) || 1);
      var retryLimit = settings.temporaryFailureRetries === undefined ? 0 : Math.max(0, Number(settings.temporaryFailureRetries) || 0);
      var retryCount = 0;
      var startedAt = this.now();
      var token = options && options.cancellationToken;
      for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
        assertNotCancelled(token);
        if (this.now() - startedAt >= timeoutMs) throw new AppError(ErrorCodes.GENERATION_TIMEOUT, "Generation polling timed out.");
        var result;
        try {
          result = await checkTask(attempt);
          retryCount = 0;
        } catch (error) {
          var retryable = typeof settings.shouldRetry === "function" && settings.shouldRetry(error, attempt, retryCount + 1);
          if (!retryable || retryCount >= retryLimit) throw error;
          retryCount += 1;
          if (typeof settings.onRetry === "function") settings.onRetry(error, attempt, retryCount);
          result = { done: false, retrying: true };
        }
        if (result && result.done) return result.value;
        if (attempt < maxAttempts) {
          await this.wait(interval);
          assertNotCancelled(token);
          if (this.now() - startedAt >= timeoutMs) throw new AppError(ErrorCodes.GENERATION_TIMEOUT, "Generation polling timed out.");
        }
      }
      throw new AppError(ErrorCodes.GENERATION_TIMEOUT, "Generation polling exceeded its maximum attempts.");
    }
  }

  return { PollingManager: PollingManager };
}));
