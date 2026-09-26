(function defineStatusView(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createStatusView() {
  "use strict";
  class StatusView {
    constructor(element, t) { this.element = element; this.t = t; }
    update(status, payload) {
      function megabytes(bytes) { return ((Number(bytes) || 0) / 1024 / 1024).toFixed(1); }
      var messages = {
        idle: this.t("statusIdle"),
        validating: this.t("statusValidating"),
        preparingImages: this.t("statusPreparingImages", { main: payload && payload.mainImageCount || 0, references: payload && payload.referenceCount || 0 }),
        imagesPrepared: this.t("statusImagesPrepared", { before: megabytes(payload && payload.beforeOptimizationPayloadBytes), after: megabytes(payload && payload.afterOptimizationPayloadBytes) }),
        submitting: this.t("statusSubmitting"),
        connecting: this.t("statusConnecting"),
        requestSubmitted: this.t("statusRequestSubmitted"),
        taskSubmitted: this.t("statusTaskSubmitted", { id: payload && payload.taskId || "-" }),
        generating: payload && typeof payload.progress === "number"
          ? this.t("statusGeneratingProgress", { progress: Math.max(0, Math.min(100, Math.round(payload.progress))) })
          : this.t("statusGenerating"),
        waiting: this.t("statusWaiting", { seconds: payload && payload.seconds || 0 }),
        fetchingResult: this.t("statusFetchingResult"),
        downloading: this.t("statusDownloading"),
        cancelled: this.t("statusCancelled"),
        completed: this.t("statusCompleted"),
        importing: this.t("statusImporting"),
        imported: payload && payload.result && payload.result.importResult && payload.result.importResult.layerNames
          ? this.t("statusImportedLayer", { layerName: payload.result.importResult.layerNames[0] })
          : this.t("statusImported"),
        importFailed: payload && payload.message ? payload.message : this.t("generatedButImportFailed"),
        failed: payload && payload.message ? payload.message : this.t("statusFailed")
      };
      this.element.textContent = messages[status] || status;
      this.element.className = "status-line status-" + status;
      this.element.setAttribute("data-status", status);
    }
  }
  return { StatusView: StatusView };
}));
