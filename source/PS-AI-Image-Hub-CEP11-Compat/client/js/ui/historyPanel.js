(function defineHistoryPanel(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createHistoryPanel(root) {
  "use strict";

  function fileUrl(path) {
    var value = String(path || "").replace(/\\/g, "/");
    return value ? "file:///" + encodeURI(value.replace(/^\/+/, "")) : "";
  }

  class HistoryPanel {
    constructor(container, options) {
      this.container = container; this.historyStore = options.historyStore; this.t = options.t;
      this.onReimport = options.onReimport || function noop() {};
      this.onRestore = options.onRestore || function noop() {};
    }
    mount() {
      this.container.innerHTML = '<div class="history-toolbar"><span class="muted">' + this.t("historyLocalHint") + '</span><button class="compact-button history-clear" type="button">' + this.t("clearHistory") + '</button></div><div class="history-list"></div>';
      this.list = this.container.querySelector(".history-list");
      this.container.querySelector(".history-clear").addEventListener("click", () => { this.historyStore.clear(); this.refresh(); });
      this.refresh();
    }
    action(label, callback, disabled) {
      var button = document.createElement("button"); button.type = "button"; button.className = "compact-button"; button.textContent = label; button.disabled = disabled === true; button.addEventListener("click", callback); return button;
    }
    refresh() {
      if (!this.list) return;
      var entries = this.historyStore.load(); this.list.innerHTML = "";
      if (!entries.length) { this.list.innerHTML = '<div class="empty-state">' + this.t("historyEmpty") + "</div>"; return; }
      entries.forEach((entry) => this.list.appendChild(this.renderEntry(entry)));
    }
    renderEntry(entry) {
      var card = document.createElement("article"); card.className = "history-card";
      if (entry.thumbnail) {
        var image = document.createElement("img"); image.className = "history-thumbnail"; image.src = fileUrl(entry.thumbnail); image.alt = entry.modelId;
        image.addEventListener("error", () => { var fallback = document.createElement("div"); fallback.className = "history-thumbnail muted"; fallback.textContent = this.t("imageCleared"); if (image.parentNode) image.parentNode.replaceChild(fallback, image); });
        card.appendChild(image);
      }
      var body = document.createElement("div"); body.className = "history-body";
      var title = document.createElement("strong"); title.textContent = entry.displayName || entry.modelId || entry.provider;
      var finalPrompt = entry.finalPrompt || entry.prompt || "";
      var summary = document.createElement("div"); summary.className = "history-prompt"; summary.textContent = finalPrompt || this.t("noPrompt");
      var meta = document.createElement("div"); meta.className = "muted"; meta.textContent = new Date(entry.createdAt).toLocaleString() + " · " + this.t("historyStatus_" + entry.status);
      var usage = document.createElement("div"); usage.className = "history-usage muted";
      var providerModel = (entry.providerDisplayName || entry.provider || "-") + " · " + (entry.modelId || "-");
      var sizeRatio = [entry.outputSize || entry.imageSize, entry.aspectRatio].filter(Boolean).join(" · ");
      var presetText = Array.isArray(entry.presetTitles) && entry.presetTitles.length ? this.t("historyPresets") + "：" + entry.presetTitles.join(" + ") : "";
      usage.textContent = [providerModel, sizeRatio, presetText].filter(Boolean).join("\n");
      var details = document.createElement("details"); var heading = document.createElement("summary"); heading.textContent = this.t("viewDetails"); details.appendChild(heading);
      var detailText = document.createElement("pre"); detailText.textContent = [this.t("apiService") + ": " + (entry.providerDisplayName || entry.provider), "Model ID: " + entry.modelId, "Task ID: " + (entry.taskId || "-"), entry.region ? this.t("region") + ": " + entry.region : "", entry.workspaceId ? "Workspace ID: " + entry.workspaceId : "", this.t("prompt") + ": " + finalPrompt,
        this.t("aspectRatio") + ": " + (entry.aspectRatio || "-"), this.t("outputResolution") + ": " + (entry.imageSize || "-"), "Error: " + (entry.errorCode || "-") + " " + (entry.errorMessage || "")].filter(Boolean).join("\n"); details.appendChild(detailText);
      var actions = document.createElement("div"); actions.className = "history-actions";
      actions.appendChild(this.action(this.t("reimport"), () => this.onReimport(entry), !entry.localResultFile));
      actions.appendChild(this.action(this.t("restoreParameters"), () => this.onRestore(entry)));
      actions.appendChild(this.action(this.t("copyPrompt"), () => root.PSAIImageHubCompat.copyText(finalPrompt)));
      actions.appendChild(this.action(this.t("copyTaskId"), () => root.PSAIImageHubCompat.copyText(entry.taskId), !entry.taskId));
      actions.appendChild(this.action(this.t("deleteHistory"), () => { this.historyStore.delete(entry.id); this.refresh(); }));
      body.appendChild(title); body.appendChild(summary); body.appendChild(meta); body.appendChild(usage); body.appendChild(details); body.appendChild(actions); card.appendChild(body); return card;
    }
  }
  return { HistoryPanel: HistoryPanel, historyFileUrl: fileUrl };
}));
