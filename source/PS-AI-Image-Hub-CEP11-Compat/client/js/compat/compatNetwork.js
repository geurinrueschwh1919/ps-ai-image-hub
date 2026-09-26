(function defineCompatNetwork(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
  root.PSAIImageHubCompat.networkTransport = api.createNetworkTransport({ root: root, preferFetch: false });
}(typeof globalThis !== "undefined" ? globalThis : this, function createCompatNetwork(root) {
  "use strict";

  function fetchResponse(scope, url, settings) {
    var startedAt = Date.now();
    var controller = new scope.AbortController();
    var timeout = Number(settings.timeout) > 0 ? Number(settings.timeout) : 30000;
    var timer = scope.setTimeout(function abortOnTimeout() { controller.abort(); }, timeout);
    var cancel = settings.cancellationToken && typeof settings.cancellationToken.subscribe === "function"
      ? settings.cancellationToken.subscribe(function abortOnCancel() { controller.abort(); }) : null;
    return scope.fetch(url, { method: settings.method || "GET", headers: settings.headers || {},
      body: settings.body === undefined ? null : settings.body, signal: controller.signal }).then(function normalize(response) {
      var bodyPromise = settings.responseType === "arraybuffer" ? response.arrayBuffer() : response.text();
      return bodyPromise.then(function bodyReady(body) {
        var normalized = {
          status: response.status, statusText: response.statusText || "", response: settings.responseType === "arraybuffer" ? body : null,
          responseText: settings.responseType === "arraybuffer" ? "" : String(body || ""),
          _psaiEffectiveTimeoutMs: timeout, _psaiDurationMs: Date.now() - startedAt,
          getResponseHeader: function getResponseHeader(name) { return response.headers && response.headers.get(name) || ""; }
        };
        if (response.status >= 200 && response.status < 300) return normalized;
        var error = new Error("HTTP request failed with status " + response.status + ".");
        error.response = normalized;
        throw error;
      });
    }).finally(function cleanup() { scope.clearTimeout(timer); if (cancel) cancel(); });
  }

  function createNetworkTransport(options) {
    var settings = options || {};
    var scope = settings.root || root || {};
    var transport = {
      lastStrategy: "none",
      request: function request(url, requestOptions, xhrFallback) {
        var requestSettings = requestOptions || {};
        var canFetch = settings.preferFetch === true && typeof scope.fetch === "function" && typeof scope.AbortController === "function";
        if (canFetch) { transport.lastStrategy = "fetch"; return fetchResponse(scope, url, requestSettings); }
        transport.lastStrategy = "xhr";
        if (typeof xhrFallback !== "function") return Promise.reject(new Error("XMLHttpRequest fallback is unavailable."));
        return xhrFallback(url, requestSettings);
      }
    };
    return transport;
  }

  return { createNetworkTransport: createNetworkTransport };
}));
