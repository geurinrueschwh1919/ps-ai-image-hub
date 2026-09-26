(function defineApiClient(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports
    ? require("../utils/errors")
    : root.PSAIImageHubCompat;
  var api = factory(errors, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createApiClient(errors, root) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var DEFAULT_TIMEOUTS = Object.freeze({ connection: 25000, generation: 600000, download: 60000 });

  function timeoutCodeFor(context) {
    if (context === "connection") return ErrorCodes.NETWORK_CONNECTION_TIMEOUT;
    if (context === "generation") return ErrorCodes.GENERATION_TIMEOUT;
    if (context === "download") return ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT;
    return ErrorCodes.NETWORK_TIMEOUT;
  }

  function effectiveTimeout(configuredTimeout, defaultTimeout) {
    var explicit = Number(configuredTimeout);
    var fallback = Number(defaultTimeout);
    if (isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    return isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 30000;
  }

  function safeServiceMessage(responseText) {
    var text = String(responseText || "").slice(0, 500);
    if (!text) return "";
    try {
      var parsed = JSON.parse(text);
      var value = parsed && (parsed.message || parsed.error && (parsed.error.message || parsed.error) || parsed.detail);
      if (typeof value === "string") return sanitizeResponsePreview(value).slice(0, 240);
    } catch (error) { /* Plain-text error body. */ }
    return sanitizeResponsePreview(text).slice(0, 240);
  }

  function mergeDetails(settings, extra) {
    return Object.assign({}, settings && settings.diagnostics || {}, extra || {});
  }

  function readResponseText(response) {
    try { return String(response && response.responseText || ""); }
    catch (error) { return ""; }
  }

  function readHeader(response, name) {
    try { return String(response && response.getResponseHeader && response.getResponseHeader(name) || ""); }
    catch (error) { return ""; }
  }

  function sanitizeResponsePreview(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|token)["']?\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi, "$1[REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, "[BASE64_REDACTED]")
      .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "[DATA_REDACTED]")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
      .replace(/\s+/g, " ").trim().slice(0, 300);
  }

  function responseDiagnostics(response) {
    var text = readResponseText(response);
    return {
      httpStatus: Number(response && response.status) || 0,
      statusText: String(response && response.statusText || ""),
      contentType: readHeader(response, "Content-Type").slice(0, 120),
      responseLength: text.length,
      responsePreview: sanitizeResponsePreview(text)
    };
  }

  function recoverEmbeddedJson(text) {
    var first = text.indexOf("{");
    var last = text.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try { return JSON.parse(text.slice(first, last + 1)); }
    catch (error) { return null; }
  }

  function recoverTaskEnvelope(text) {
    var id = text.match(/\b["']?id["']?\s*:\s*["']?([A-Za-z0-9._:-]{1,200})["']?/i);
    var status = text.match(/\b["']?status["']?\s*:\s*["']?(running|pending|queued|processing|succeeded|failed|violation|cancelled)["']?/i);
    if (!id || !status) return null;
    return { id: id[1], status: status[1].toLowerCase(), _recoveredFromText: true };
  }

  function parseJsonResponseText(responseText, options) {
    var settings = options || {};
    var text = String(responseText || "").replace(/^\uFEFF/, "").trim();
    var contentType = String(settings.contentType || "").toLowerCase();
    var details = settings.details || {};
    if (!text) throw new AppError(ErrorCodes.EMPTY_RESPONSE, "HTTP response body is empty.", details);
    if (contentType.indexOf("text/html") !== -1 || /^<!doctype\s+html/i.test(text) || /^<html[\s>]/i.test(text)) {
      throw new AppError(ErrorCodes.UPSTREAM_HTML_RESPONSE, "Upstream returned HTML instead of JSON.", details);
    }
    try { return JSON.parse(text); }
    catch (directError) { /* Compatibility parsing follows. */ }

    var isStream = contentType.indexOf("text/event-stream") !== -1 || /^(data|event):/m.test(text);
    if (isStream) {
      var dataLines = text.split(/\r?\n/).filter(function dataLine(line) { return /^data:\s*/.test(line); });
      for (var index = dataLines.length - 1; index >= 0; index -= 1) {
        var data = dataLines[index].replace(/^data:\s*/, "").trim();
        if (!data || data === "[DONE]") continue;
        try { return JSON.parse(data); }
        catch (streamError) { /* Try another data frame. */ }
      }
      var streamTask = settings.allowTaskEnvelope ? recoverTaskEnvelope(text) : null;
      if (streamTask) return streamTask;
      throw new AppError(ErrorCodes.UNEXPECTED_STREAM_RESPONSE, "Stream response did not contain a usable JSON event.", details);
    }

    if (settings.allowEmbeddedJson) {
      var embedded = recoverEmbeddedJson(text);
      if (embedded) return embedded;
    }
    if (settings.allowTaskEnvelope) {
      var task = recoverTaskEnvelope(text);
      if (task) return task;
    }
    if (/^[\[{]/.test(text)) throw new AppError(ErrorCodes.INVALID_RESPONSE, "Response contains malformed JSON.", details);
    throw new AppError(ErrorCodes.NON_JSON_TEXT_RESPONSE, "Upstream returned non-JSON text.", details);
  }

  function notifyObserver(callback, first, second) {
    if (typeof callback !== "function") return;
    try { callback(first, second); }
    catch (error) {
      // Observability/UI callbacks must never prevent or change an HTTP request.
      if (root.console && typeof root.console.warn === "function") root.console.warn("[PS AI Image Hub CEP] Request observer failed", error && error.message || error);
    }
  }

  class ApiClient {
    constructor(options) {
      this.timeout = options && options.timeout || 30000;
      this.xhrFactory = options && options.xhrFactory || function createXhr() { return new root.XMLHttpRequest(); };
      this.networkTransport = options && options.networkTransport || null;
    }

    request(url, options) {
      var self = this;
      if (this.networkTransport && typeof this.networkTransport.request === "function") {
        return this.networkTransport.request(url, options || {}, function xhrFallback(fallbackUrl, fallbackOptions) {
          return self.requestXhr(fallbackUrl, fallbackOptions);
        });
      }
      return this.requestXhr(url, options);
    }

    requestXhr(url, options) {
      var settings = options || {};
      var xhrFactory = this.xhrFactory;
      var timeout = this.timeout;
      var effectiveTimeoutMs = effectiveTimeout(Object.prototype.hasOwnProperty.call(settings, "timeout") ? settings.timeout : null, timeout);
      var xhr = null;
      var settled = false;
      var cancelUnsubscribe = null;
      var startedAt = Date.now();
      var promise = new Promise(function perform(resolve, reject) {
        try { xhr = xhrFactory(); }
        catch (error) { reject(new AppError(ErrorCodes.NETWORK, "Could not create XMLHttpRequest.", mergeDetails(settings, { effectiveTimeoutMs: effectiveTimeoutMs }))); return; }
        try { xhr.open(settings.method || "GET", url, true); }
        catch (error) { reject(new AppError(ErrorCodes.NETWORK, "Could not open XMLHttpRequest.", mergeDetails(settings, { effectiveTimeoutMs: effectiveTimeoutMs, message: error && error.message }))); return; }
        xhr.timeout = effectiveTimeoutMs;
        xhr._psaiEffectiveTimeoutMs = effectiveTimeoutMs;
        xhr._psaiStartedAt = startedAt;
        notifyObserver(settings.onRequestConfigured, xhr, {
          method: settings.method || "GET", effectiveTimeoutMs: xhr.timeout
        });
        if (settings.responseType) xhr.responseType = settings.responseType;
        Object.keys(settings.headers || {}).forEach(function setHeader(name) {
          xhr.setRequestHeader(name, settings.headers[name]);
        });
        xhr.onload = function onLoad() {
          if (settled) return;
          settled = true;
          if (cancelUnsubscribe) cancelUnsubscribe();
          xhr._psaiDurationMs = Date.now() - startedAt;
          notifyObserver(settings.onResponseReceived, xhr, {
            method: settings.method || "GET", effectiveTimeoutMs: xhr.timeout, durationMs: xhr._psaiDurationMs
          });
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
          else {
            // HTTP 413 is terminal before any task exists: never poll, recover, or wait for generation timeout.
            var code = xhr.status === 413
              ? ErrorCodes.PAYLOAD_TOO_LARGE
              : settings.httpErrorCode || (xhr.status >= 500 ? ErrorCodes.HTTP_SERVER : ErrorCodes.HTTP_CLIENT);
            var responseText = "";
            try { responseText = String(xhr.responseText || "").slice(0, 500); } catch (error) { responseText = ""; }
            reject(new AppError(code, "HTTP request failed with status " + xhr.status + ".", mergeDetails(settings, {
              status: xhr.status,
              serviceMessage: safeServiceMessage(responseText),
              effectiveTimeoutMs: xhr.timeout,
              durationMs: xhr._psaiDurationMs
            })));
          }
        };
        xhr.onerror = function onError() {
          if (settled) return;
          settled = true;
          if (cancelUnsubscribe) cancelUnsubscribe();
          reject(new AppError(settings.corsAware ? ErrorCodes.CORS_ERROR : ErrorCodes.NETWORK, "Network or CORS request failed.",
            mergeDetails(settings, { effectiveTimeoutMs: xhr.timeout, durationMs: Date.now() - startedAt })));
        };
        xhr.ontimeout = function onTimeout() {
          if (settled) return;
          settled = true;
          if (cancelUnsubscribe) cancelUnsubscribe();
          reject(new AppError(settings.timeoutCode || timeoutCodeFor(settings.timeoutContext), "Request timed out.",
            mergeDetails(settings, { timeout: xhr.timeout, effectiveTimeoutMs: xhr.timeout, durationMs: Date.now() - startedAt })));
        };
        xhr.onabort = function onAbort() {
          if (settled) return;
          settled = true;
          if (cancelUnsubscribe) cancelUnsubscribe();
          reject(new AppError(ErrorCodes.CANCELLED, "Request was cancelled.",
            mergeDetails(settings, { effectiveTimeoutMs: xhr.timeout, durationMs: Date.now() - startedAt })));
        };
        if (settings.cancellationToken && typeof settings.cancellationToken.subscribe === "function") {
          cancelUnsubscribe = settings.cancellationToken.subscribe(function abortRequest() {
            try { xhr.abort(); } catch (error) { xhr.onabort(); }
          });
        }
        notifyObserver(settings.onSendEntered, xhr, {
          method: settings.method || "GET", effectiveTimeoutMs: xhr.timeout
        });
        try { xhr.send(settings.body === undefined ? null : settings.body); }
        catch (error) {
          if (settled) return;
          settled = true;
          if (cancelUnsubscribe) cancelUnsubscribe();
          reject(new AppError(settings.sendErrorCode || ErrorCodes.NETWORK, "XMLHttpRequest send failed.",
            mergeDetails(settings, { stage: "xhrSend", effectiveTimeoutMs: xhr.timeout, durationMs: Date.now() - startedAt, message: error && error.message })));
          return;
        }
        if (!settled) notifyObserver(settings.onRequestStarted, xhr, {
          method: settings.method || "GET", effectiveTimeoutMs: xhr.timeout
        });
      });
      promise.abort = function abort() { if (xhr && !settled) xhr.abort(); };
      return promise;
    }

    async requestJson(url, options) {
      var response = await this.request(url, options);
      var diagnostics = responseDiagnostics(response);
      diagnostics.status = diagnostics.httpStatus;
      diagnostics.effectiveTimeoutMs = response._psaiEffectiveTimeoutMs;
      diagnostics.durationMs = response._psaiDurationMs;
      notifyObserver(options && options.onResponseDiagnostics, diagnostics);
      return parseJsonResponseText(readResponseText(response), {
        contentType: diagnostics.contentType,
        allowEmbeddedJson: Boolean(options && options.allowEmbeddedJson),
        allowTaskEnvelope: Boolean(options && options.allowTaskEnvelope),
        details: mergeDetails(options || {}, diagnostics)
      });
    }

    async requestArrayBuffer(url, options) {
      var settings = Object.assign({ timeout: DEFAULT_TIMEOUTS.download, timeoutContext: "download" }, options || {}, { responseType: "arraybuffer" });
      var response;
      try { response = await this.request(url, settings); }
      catch (error) {
        if (error && [ErrorCodes.HTTP_CLIENT, ErrorCodes.HTTP_SERVER, ErrorCodes.HTTP_ERROR, ErrorCodes.NETWORK_TIMEOUT,
          ErrorCodes.IMAGE_DOWNLOAD_TIMEOUT, ErrorCodes.CANCELLED, ErrorCodes.CORS_ERROR].indexOf(error.code) !== -1) throw error;
        throw new AppError(ErrorCodes.IMAGE_DOWNLOAD_FAILED, "Image download failed.", { causeCode: error && error.code });
      }
      var mimeType = "";
      try { mimeType = String(response.getResponseHeader("Content-Type") || "").split(";")[0].toLowerCase(); } catch (error) { mimeType = ""; }
      return { bytes: response.response, mimeType: mimeType };
    }
  }

  return { ApiClient: ApiClient, API_TIMEOUTS: DEFAULT_TIMEOUTS, timeoutCodeFor: timeoutCodeFor,
    resolveEffectiveTimeout: effectiveTimeout, parseJsonResponseText: parseJsonResponseText,
    responseDiagnostics: responseDiagnostics, sanitizeResponsePreview: sanitizeResponsePreview };
}));
