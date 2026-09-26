(function defineResultView(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createResultView() {
  "use strict";
  class ResultView {
    constructor(container, t) { this.container = container; this.t = t; }
    clear() { this.container.innerHTML = '<p class="empty-state">' + this.t("noResult") + "</p>"; }
    render(result) {
      var image = result.images[0];
      this.container.innerHTML = "";
      var preview = document.createElement("img");
      preview.className = "result-image";
      preview.src = image.previewUrl;
      preview.alt = this.t("mockResultAlt");
      var caption = document.createElement("p");
      caption.className = "result-caption";
      caption.textContent = this.t("generatedFrom", { prompt: result.prompt });
      var importState = document.createElement("p");
      importState.className = "muted result-caption";
      importState.setAttribute("data-role", "import-state");
      this.container.appendChild(preview);
      this.container.appendChild(caption);
      this.container.appendChild(importState);
      this.updateImportState(result);
    }
    updateImportState(result) {
      var importState = this.container.querySelector('[data-role="import-state"]');
      if (!importState) return;
      var messages = {
        notImported: this.t("notImported"),
        importing: this.t("statusImporting"),
        imported: result.importResult && result.importResult.layerNames
          ? this.t("statusImportedLayer", { layerName: result.importResult.layerNames[0] })
          : this.t("statusImported"),
        failed: this.t("generatedButImportFailed")
      };
      importState.textContent = messages[result.importState] || this.t("notImported");
    }
  }
  return { ResultView: ResultView };
}));
