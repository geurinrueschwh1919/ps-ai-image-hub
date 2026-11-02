(function defineHistoryPanel(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createHistoryPanel(root) {
  "use strict";

  var PAGE_SIZE = 20;

  function fileUrl(path) {
    var value = String(path || "").replace(/\\/g, "/");
    return value ? "file:///" + encodeURI(value.replace(/^\/+/, "")) : "";
  }

  function searchableText(entry) {
    return [entry.providerDisplayName, entry.provider, entry.displayName, entry.modelId, entry.finalPrompt, entry.prompt,
      entry.taskId, entry.status, entry.aspectRatio, entry.outputSize, entry.imageSize,
      Array.isArray(entry.presetTitles) ? entry.presetTitles.join(" ") : ""].join(" ").toLowerCase();
  }

  function filterEntries(entries, query, filter) {
    var needle = String(query || "").trim().toLowerCase();
    return (Array.isArray(entries) ? entries : []).filter(function include(entry) {
      if (filter === "favorites" && entry.favorite !== true) return false;
      if (filter && filter !== "all" && filter !== "favorites" && entry.status !== filter) return false;
      return !needle || searchableText(entry).indexOf(needle) !== -1;
    });
  }

  function pageEntries(entries, visibleCount) { return entries.slice(0, Math.max(PAGE_SIZE, Number(visibleCount) || PAGE_SIZE)); }

  class HistoryPanel {
    constructor(container, options) {
      this.container = container; this.historyStore = options.historyStore; this.t = options.t;
      this.onReimport = options.onReimport || function noop() {};
      this.onRestore = options.onRestore || function noop() {};
      this.onBusyChange = options.onBusyChange || function noopBusyChange() {};
      this.visibleCount = PAGE_SIZE; this.query = ""; this.filter = "all"; this.searchTimer = null;
      this.busy = false; this.mounted = false;
    }
    mount() {
      if (this.mounted) return;
      this.mounted = true;
      this.container.innerHTML = '<div class="history-toolbar"><span class="muted history-capacity-hint"></span><button class="compact-button history-clear" type="button">' + this.t("clearHistory") + '</button></div>' +
        '<div class="history-filters"><input class="history-search" type="search" placeholder="' + this.t("historySearchPlaceholder") + '" />' +
        '<select class="history-filter"><option value="all">' + this.t("historyFilterAll") + '</option><option value="favorites">' + this.t("historyFavorites") + '</option><option value="succeeded">' + this.t("historyStatus_succeeded") + '</option><option value="failed">' + this.t("historyStatus_failed") + '</option></select></div>' +
        '<div class="history-message muted" aria-live="polite"></div><div class="history-list"></div><button class="history-load-more" type="button" hidden>' + this.t("historyLoadMore") + "</button>";
      this.list = this.container.querySelector(".history-list");
      this.message = this.container.querySelector(".history-message");
      this.loadMoreButton = this.container.querySelector(".history-load-more");
      this.capacityHint = this.container.querySelector(".history-capacity-hint");
      this.container.querySelector(".history-clear").addEventListener("click", () => this.runMutation(() => { this.historyStore.clear(); this.refresh(); }));
      this.container.querySelector(".history-search").addEventListener("input", (event) => {
        if (this.searchTimer && root.clearTimeout) root.clearTimeout(this.searchTimer);
        var value = event.target.value;
        this.searchTimer = root.setTimeout(() => { this.query = value; this.refresh(); }, 200);
      });
      this.container.querySelector(".history-filter").addEventListener("change", (event) => { this.filter = event.target.value; this.refresh(); });
      this.loadMoreButton.addEventListener("click", () => this.loadNextPage());
      this.list.addEventListener("scroll", () => {
        if (this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24) this.loadNextPage();
      });
      this.refresh();
    }
    isBusy() { return this.busy === true; }
    setBusy(value) { this.busy = value === true; this.onBusyChange(this.busy); }
    runMutation(callback) {
      if (this.busy) return false;
      this.setBusy(true);
      try { callback(); return true; }
      finally { this.setBusy(false); }
    }
    action(label, callback, disabled) {
      var button = document.createElement("button"); button.type = "button"; button.className = "compact-button"; button.textContent = label; button.disabled = disabled === true; button.addEventListener("click", callback); return button;
    }
    refresh() {
      if (!this.list) return;
      this.visibleCount = PAGE_SIZE;
      var capacity = this.historyStore.getMaxHistoryCount ? this.historyStore.getMaxHistoryCount() : 100;
      this.capacityHint.textContent = this.t("historyLocalHint", { count: capacity });
      this.renderPage();
    }
    renderPage() {
      var entries = filterEntries(this.historyStore.load(), this.query, this.filter);
      var visible = pageEntries(entries, this.visibleCount);
      this.list.innerHTML = "";
      if (!visible.length) {
        this.list.innerHTML = '<div class="empty-state">' + (this.filter === "favorites" ? this.t("historyFavoritesEmpty") : this.t("historyEmpty")) + "</div>";
        this.loadMoreButton.hidden = true; return;
      }
      var fragment = document.createDocumentFragment();
      visible.forEach((entry) => fragment.appendChild(this.renderEntry(entry)));
      this.list.appendChild(fragment);
      this.loadMoreButton.hidden = visible.length >= entries.length;
    }
    loadNextPage() {
      if (!this.loadMoreButton || this.loadMoreButton.hidden) return;
      this.visibleCount += PAGE_SIZE; this.renderPage();
    }
    attachThumbnail(card, entry) {
      var image = document.createElement("img"); image.className = "history-thumbnail"; image.alt = entry.modelId; image.loading = "lazy";
      var usableThumbnail = entry.thumbnail && entry.thumbnail !== entry.localResultFile;
      if (usableThumbnail) image.src = fileUrl(entry.thumbnail);
      else image.className += " history-thumbnail-pending";
      image.addEventListener("error", () => { var fallback = document.createElement("div"); fallback.className = "history-thumbnail muted"; fallback.textContent = this.t("imageCleared"); if (image.parentNode) image.parentNode.replaceChild(fallback, image); });
      card.appendChild(image);
      if (!usableThumbnail && entry.localResultFile && this.historyStore.ensureThumbnail) {
        this.historyStore.ensureThumbnail(entry.id).then(function ready(path) { if (path && image.parentNode) { image.src = fileUrl(path); image.className = "history-thumbnail"; } });
      }
    }
    renderEntry(entry) {
      var card = document.createElement("article"); card.className = "history-card"; this.attachThumbnail(card, entry);
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
      var detailText = document.createElement("pre"); detailText.textContent = [this.t("apiService") + ": " + (entry.providerDisplayName || entry.provider), "Model ID: " + entry.modelId, "Task ID: " + (entry.taskId || "-"), entry.region ? this.t("region") + ": " + entry.region : "", entry.endpointMode ? "Endpoint: " + entry.endpointMode : "", this.t("prompt") + ": " + finalPrompt,
        this.t("aspectRatio") + ": " + (entry.aspectRatio || "-"), this.t("outputResolution") + ": " + (entry.imageSize || "-"), "Error: " + (entry.errorCode || "-") + " " + (entry.errorMessage || "")].filter(Boolean).join("\n"); details.appendChild(detailText);
      var actions = document.createElement("div"); actions.className = "history-actions";
      actions.appendChild(this.action(entry.favorite ? this.t("historyFavorited") : this.t("historyFavorite"), () => { this.historyStore.setFavorite(entry.id, !entry.favorite); this.refresh(); }));
      actions.appendChild(this.action(this.t("reimport"), () => this.onReimport(entry), !entry.localResultFile && !entry.resultUrl));
      actions.appendChild(this.action(this.t("restoreParameters"), () => this.onRestore(entry)));
      actions.appendChild(this.action(this.t("copyPrompt"), () => root.PSAIImageHubCompat.copyText(finalPrompt)));
      actions.appendChild(this.action(this.t("copyTaskId"), () => root.PSAIImageHubCompat.copyText(entry.taskId), !entry.taskId));
      actions.appendChild(this.action(this.t("deleteHistory"), () => this.runMutation(() => { if (!this.historyStore.delete(entry.id)) this.message.textContent = this.t("historyDeleteFailed"); else { this.message.textContent = ""; this.refresh(); } })));
      body.appendChild(title); body.appendChild(summary); body.appendChild(meta); body.appendChild(usage); body.appendChild(details); body.appendChild(actions); card.appendChild(body); return card;
    }
  }
  return { HistoryPanel: HistoryPanel, historyFileUrl: fileUrl, filterHistoryEntries: filterEntries,
    pageHistoryEntries: pageEntries, HISTORY_PAGE_SIZE: PAGE_SIZE };
}));
