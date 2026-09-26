(function defineSettingsPanel(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsPanel(root) {
  "use strict";

  var TOOLTIP_KEYS = Object.freeze([
    "helpProviderName", "helpProviderType", "helpBaseUrl", "helpEndpoint", "helpApiKey", "helpModelList",
    "helpModelId", "helpResponseType", "helpAuthType", "helpCustomHeader",
    "helpResponsePath", "helpTaskIdPath", "helpRequestTemplate", "helpPollingEndpoint", "helpPollingResultPath", "helpGrsNode", "helpAliyunRegion"
  ]);

  function getProviderFieldVisibility(providerType, authType) {
    var type = providerType || "openai-compatible";
    return {
      providerName: true,
      providerType: true,
      baseUrl: true,
      endpoint: true,
      apiKey: true,
      modelId: type !== "generic-rest",
      modelList: type === "generic-rest",
      responseType: true,
      authType: true,
      customHeader: authType === "custom-header",
      responsePath: type === "generic-rest" || type === "async-task",
      requestTemplate: type === "generic-rest",
      pollingEndpoint: type === "async-task",
      pollingResultPath: type === "async-task"
    };
  }

  function getSettingsSectionVisibility(advancedExpanded) {
    return { basic: true, advanced: advancedExpanded === true };
  }

  function getResultTypeVisibility(providerType) {
    var isAsync = providerType === "async-task";
    return { auto: !isAsync, url: !isAsync, base64: !isAsync, "task-id": isAsync };
  }

  function getConfigValidationKey(config, hasSecret) {
    var value = config || {};
    if (!String(value.displayName || "").trim()) return "errorProviderNameRequired";
    if (!/^https?:\/\//i.test(String(value.baseUrl || "").trim())) return "errorMissingBaseUrl";
    if (!String(value.endpointPath || "").trim()) return "errorMissingEndpoint";
    if (value.authType !== "none" && !hasSecret) return "errorMissingApiKey";
    if (!String(value.modelId || "").trim()) return "errorModelIdRequired";
    if (value.authType === "custom-header" && !String(value.customHeaderName || "").trim()) return "errorCustomHeaderRequired";
    if (value.type === "generic-rest" && !String(value.responsePath || "").trim()) return "errorResponsePathRequired";
    if (value.type === "async-task" && (!String(value.responsePath || "").trim() || !String(value.pollingEndpoint || "").trim() || !String(value.pollingResultPath || "").trim())) {
      return "errorAsyncFieldsRequired";
    }
    return null;
  }

  function buildStorageUsageMarkup(report, t) {
    var categories = report && report.categories || {};
    function category(name) { return categories[name] || { fileCount: 0 }; }
    var rows = [
      ["storageTemporaryInputs", category("temporaryInputs")], ["storageRecoveryImages", category("recoveryImages")],
      ["storageHistoryImages", category("historyImages")], ["storageDownloads", category("downloads")],
      ["storageLogs", category("logs")], ["storageOtherCache", category("other")]
    ];
    return rows.map(function render(row) {
      return '<div class="storage-usage-row"><span class="storage-usage-label">' + t(row[0]) +
        '</span><strong class="storage-usage-count">' + t("storageFileCount", { count: Number(row[1].fileCount) || 0 }) + "</strong></div>";
    }).join("");
  }

  class SettingsPanel {
    constructor(container, toggleButton, t, options) {
      this.container = container;
      this.toggleButton = toggleButton;
      this.t = t;
      this.expanded = Boolean(options && options.embeddedTab);
      this.advancedExpanded = false;
      this.providerManager = options && options.providerManager;
      this.uiStateStore = options && options.uiStateStore || null;
      this.storageManager = options && options.storageManager || null;
      this.onProvidersChanged = options && options.onProvidersChanged || function noop() {};
      this.editingId = null;
      this.forgetPersistentKey = false;
      this.tooltipPinned = false;
      this.activeHelpButton = null;
    }

    helpLabel(labelKey, helpKey, fieldId) {
      return '<span class="field-heading"><span>' + this.t(labelKey) + '</span>' +
        '<button class="help-button" type="button" data-help-key="' + helpKey + '" aria-label="' +
        this.t("showHelpFor", { field: this.t(labelKey) }) + '" aria-expanded="false" aria-controls="provider-tooltip">?</button></span>' +
        '<span class="sr-only" id="' + fieldId + '-description">' + this.t(helpKey) + "</span>";
    }

    mount() {
      var grsModelOptions = (root.PSAIImageHubCompat.GRS_MODEL_CATALOG || []).map(function modelOption(model) {
        return '<option value="' + model.modelId + '">' + model.displayName + "</option>";
      }).join("");
      var aliyunModelOptions = (root.PSAIImageHubCompat.ALIYUN_BAILIAN_MODEL_CATALOG || []).map(function modelOption(model) {
        return '<option value="' + model.modelId + '">' + model.displayName + "</option>";
      }).join("");
      var aliyunRegionOptions = (root.PSAIImageHubCompat.getAliyunBailianSupportedRegions
        ? root.PSAIImageHubCompat.getAliyunBailianSupportedRegions("qwen-image-3.0")
        : []).map(function regionOption(region) {
        return '<option value="' + region.id + '">' + region.label + "</option>";
      }).join("");
      this.container.innerHTML = `
        <div class="settings-guide"><strong>${this.t("settingsStepsTitle")}</strong><span>${this.t("settingsSteps")}</span><span id="provider-type-guide"></span></div>
        <p class="muted">${this.t("storageHint")}</p>
        <label class="field-label" for="settings-provider-list">${this.t("providerList")}</label>
        <select id="settings-provider-list"></select>
        <div class="button-row"><button id="provider-new" type="button">${this.t("newProvider")}</button><button id="provider-delete" type="button">${this.t("deleteProvider")}</button></div>

        <section class="provider-section basic-section" data-settings-section="basic">
          <h3>${this.t("basicSettings")}</h3>
          <div class="provider-form">
            <label class="provider-field" data-field="providerName" for="provider-name">${this.helpLabel("providerName", "helpProviderName", "provider-name")}<input id="provider-name" type="text" placeholder="${this.t("providerNamePlaceholder")}" aria-describedby="provider-name-description" /></label>
            <label class="provider-field" data-field="providerType" for="provider-type">${this.helpLabel("providerType", "helpProviderType", "provider-type")}<select id="provider-type" aria-describedby="provider-type-description"><option value="openai-compatible">OpenAI-Compatible</option><option value="generic-rest">Generic REST</option><option value="async-task">Async Task API</option></select></label>
            <label class="provider-field" data-field="baseUrl" for="provider-base-url">${this.helpLabel("baseUrl", "helpBaseUrl", "provider-base-url")}<input id="provider-base-url" type="text" placeholder="https://api.openai.com" aria-describedby="provider-base-url-description" /></label>
            <label class="provider-field" data-field="endpoint" for="provider-endpoint"><span class="dynamic-endpoint-label">${this.helpLabel("endpoint", "helpEndpoint", "provider-endpoint")}</span><input id="provider-endpoint" type="text" placeholder="/v1/images/generations" aria-describedby="provider-endpoint-description" /></label>
            <label class="provider-field" data-field="apiKey" for="provider-api-key">${this.helpLabel("apiKey", "helpApiKey", "provider-api-key")}<input id="provider-api-key" type="password" placeholder="${this.t("apiKeyPlaceholder")}" autocomplete="off" aria-describedby="provider-api-key-description" /><span class="inline-check"><input id="provider-remember-key" type="checkbox" /> ${this.t("rememberApiKey")}</span><small class="muted">${this.t("rememberApiKeyHint")}</small><span class="secret-status-row"><span id="provider-key-status" class="muted"></span><button id="provider-clear-key" class="compact-button" type="button" hidden>${this.t("clearSavedApiKey")}</button></span></label>
            <label class="provider-field" data-field="modelId" for="provider-model">${this.helpLabel("modelId", "helpModelId", "provider-model")}<input id="provider-model" type="text" placeholder="gpt-image-1" aria-describedby="provider-model-description" /></label>
            <div class="provider-field model-manager" data-field="modelList">
              ${this.helpLabel("modelList", "helpModelList", "provider-model-list")}
              <div id="provider-model-list" class="managed-model-list"></div>
              <div class="managed-model-editor"><input id="model-display-name" type="text" placeholder="${this.t("modelDisplayName")}" /><input id="model-id" type="text" placeholder="Model ID" /><button id="model-add" type="button">${this.t("addModel")}</button></div>
            </div>
            <label class="provider-field" data-field="responseType" for="provider-result-type">${this.helpLabel("responseType", "helpResponseType", "provider-result-type")}<select id="provider-result-type" aria-describedby="provider-result-type-description"><option value="auto">${this.t("resultTypeAuto")}</option><option value="url">${this.t("resultTypeUrl")}</option><option value="base64">${this.t("resultTypeBase64")}</option><option value="task-id">${this.t("resultTypeTaskId")}</option></select></label>
          </div>
        </section>

        <section id="grs-settings" class="provider-section grs-settings" hidden>
          <h3>GRS</h3>
          <p class="muted">${this.t("grsBuiltInHint")}</p>
          <div class="provider-form">
            <label>${this.helpLabel("grsNode", "helpGrsNode", "grs-node")}<select id="grs-node" aria-describedby="grs-node-description"><option value="global">${this.t("grsGlobalNode")}</option><option value="china">${this.t("grsChinaNode")}</option><option value="custom">${this.t("grsCustomNode")}</option></select></label>
            <label id="grs-custom-base-field" hidden>${this.t("baseUrl")}<input id="grs-custom-base-url" type="text" placeholder="https://your-grs-endpoint.example" /></label>
            <label>${this.helpLabel("apiKey", "helpApiKey", "grs-api-key")}<input id="grs-api-key" type="password" placeholder="${this.t("apiKeyPlaceholder")}" autocomplete="off" aria-describedby="grs-api-key-description" /><span class="inline-check"><input id="grs-remember-key" type="checkbox" /> ${this.t("rememberApiKey")}</span><small class="muted">${this.t("rememberApiKeyHint")}</small><span class="secret-status-row"><span id="grs-key-status" class="muted"></span><button id="grs-clear-key" class="compact-button" type="button" hidden>${this.t("clearSavedApiKey")}</button></span></label>
            <div class="credits-line"><span>${this.t("apiKeyCredits")}：<strong id="grs-key-credits">—</strong></span><button id="grs-refresh-credits" class="compact-button" type="button">${this.t("refresh")}</button></div>
            <label>${this.t("model")}<select id="grs-model">${grsModelOptions}</select></label>
            <label id="grs-image-size-field">${this.t("outputResolution")}<select id="grs-image-size"><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></label>
          </div>
          <details class="grs-advanced-info"><summary>${this.t("advancedInfo")}</summary><dl><dt>Base URL</dt><dd id="grs-info-base-url"></dd><dt>Endpoint</dt><dd>/v1/api/generate</dd><dt>Auth</dt><dd>Bearer Token</dd></dl></details>
        </section>

        <section id="aliyun-settings" class="provider-section aliyun-settings" hidden>
          <h3>${this.t("aliyunBailian")}</h3>
          <p class="muted">Alibaba Cloud Model Studio · ${this.t("aliyunBuiltInHint")}</p>
          <dl><dt>${this.t("providerType")}</dt><dd>Async Task API</dd></dl>
          <div class="provider-form">
            <label>${this.helpLabel("region", "helpAliyunRegion", "aliyun-region")}<small class="muted">Region</small><select id="aliyun-region" aria-describedby="aliyun-region-description">${aliyunRegionOptions}</select></label>
            <label>Workspace ID<input id="aliyun-workspace-id" type="text" autocomplete="off" placeholder="Workspace ID" /></label>
            <label>${this.helpLabel("apiKey", "helpApiKey", "aliyun-api-key")}<input id="aliyun-api-key" type="password" placeholder="${this.t("apiKeyPlaceholder")}" autocomplete="off" aria-describedby="aliyun-api-key-description" /><span class="inline-check"><input id="aliyun-remember-key" type="checkbox" /> ${this.t("rememberApiKey")}</span><small class="muted">${this.t("rememberApiKeyHint")}</small><span class="secret-status-row"><span id="aliyun-key-status" class="muted"></span><button id="aliyun-clear-key" class="compact-button" type="button" hidden>${this.t("clearSavedApiKey")}</button></span></label>
            <label>${this.t("defaultModel")}<select id="aliyun-model">${aliyunModelOptions}</select></label>
          </div>
          <p class="muted">${this.t("bailianTemporaryResultHint")}</p>
          <p class="muted">${this.t("bailianCostHint")}</p>
          <details><summary>${this.t("advancedInfo")}</summary><dl><dt>Endpoint</dt><dd id="aliyun-info-endpoint"></dd><dt>Auth</dt><dd>Bearer Token</dd><dt>Async Header</dt><dd>X-DashScope-Async: enable</dd></dl></details>
        </section>

        <section class="provider-section advanced-section" data-settings-section="advanced">
          <button id="advanced-toggle" class="advanced-toggle" type="button" aria-expanded="false" aria-controls="advanced-fields"><span>${this.t("advancedSettings")}</span><span class="disclosure-mark">▸</span></button>
          <div id="advanced-fields" class="provider-form" hidden>
            <label class="provider-field" data-field="authType" for="provider-auth-type">${this.helpLabel("authType", "helpAuthType", "provider-auth-type")}<select id="provider-auth-type" aria-describedby="provider-auth-type-description"><option value="bearer">Bearer Token</option><option value="x-api-key">x-api-key</option><option value="custom-header">${this.t("authCustomHeader")}</option><option value="none">${this.t("authNone")}</option></select></label>
            <label class="provider-field" data-field="customHeader" for="provider-custom-header">${this.helpLabel("customHeader", "helpCustomHeader", "provider-custom-header")}<input id="provider-custom-header" type="text" placeholder="X-Service-Key" aria-describedby="provider-custom-header-description" /></label>
            <label class="provider-field" data-field="responsePath" for="provider-response-path"><span class="dynamic-response-label">${this.helpLabel("responsePath", "helpResponsePath", "provider-response-path")}</span><input id="provider-response-path" type="text" placeholder="data[0].url" aria-describedby="provider-response-path-description" /></label>
            <label class="provider-field" data-field="requestTemplate" for="provider-template">${this.helpLabel("requestTemplate", "helpRequestTemplate", "provider-template")}<textarea id="provider-template" rows="4" placeholder='{"model":"{{modelId}}","prompt":"{{prompt}}"}' aria-describedby="provider-template-description"></textarea></label>
            <label class="provider-field" data-field="pollingEndpoint" for="provider-polling-endpoint">${this.helpLabel("pollingEndpoint", "helpPollingEndpoint", "provider-polling-endpoint")}<input id="provider-polling-endpoint" type="text" placeholder="/tasks/{task_id}" aria-describedby="provider-polling-endpoint-description" /></label>
            <label class="provider-field" data-field="pollingResultPath" for="provider-polling-path">${this.helpLabel("pollingResultPath", "helpPollingResultPath", "provider-polling-path")}<input id="provider-polling-path" type="text" placeholder="result.url" aria-describedby="provider-polling-path-description" /></label>
          </div>
        </section>

        <div class="button-row"><button id="provider-test" type="button">${this.t("testConnection")}</button><button id="provider-save" class="secondary-button" type="button">${this.t("save")}</button></div>
        <div id="provider-message" class="muted"></div>
        <section class="provider-section storage-section">
          <h3>${this.t("importSettings")}</h3>
          <label class="inline-check" title="${this.t("matchMainSizeHelp")}"><input id="match-main-size" type="checkbox" /> ${this.t("matchMainSize")}</label>
          <small class="muted">${this.t("matchMainSizeHelp")}</small>
        </section>
        <section class="provider-section storage-section">
          <h3>${this.t("storageAndCache")}</h3>
          <p class="muted storage-warning">${this.t("localStorageOnlyWarning")}</p>
          <div class="storage-path-row"><span>${this.t("localDataDirectory")}</span><code id="storage-root-path"></code><button id="copy-storage-path" class="compact-button" type="button">${this.t("copyPath")}</button></div>
          <span class="storage-action-heading">${this.t("storageFiles")}</span>
          <div id="storage-usage" class="storage-usage"></div>
          <div class="storage-actions"><button id="refresh-storage" type="button">${this.t("refreshStorage")}</button><div class="storage-action-group"><span class="storage-action-heading">${this.t("storageImageCacheActions")}</span><button id="clear-temp-cache" type="button">${this.t("clearTemporaryInputs")}</button><button id="clear-recovery-images" type="button">${this.t("clearRecoveryImages")}</button><button id="clear-download-cache" type="button">${this.t("clearDownloadCache")}</button><button id="clear-history-images" type="button">${this.t("clearHistoryImages")}</button></div><div class="storage-action-group storage-danger-group"><span class="storage-action-heading">${this.t("storageDangerActions")}</span><button id="clear-all-image-cache" class="danger-button" type="button">${this.t("clearAllImageCache")}</button><button id="clear-recovery-records" class="danger-button" type="button">${this.t("clearRecoveryRecords")}</button></div></div>
          <div id="storage-message" class="muted"></div>
        </section>
        <div id="provider-tooltip" class="help-tooltip" role="tooltip" hidden></div>`;

      if (this.toggleButton) this.toggleButton.addEventListener("click", () => this.toggle());
      this.list = this.container.querySelector("#settings-provider-list");
      this.message = this.container.querySelector("#provider-message");
      this.tooltip = this.container.querySelector("#provider-tooltip");
      this.advancedFields = this.container.querySelector("#advanced-fields");
      this.advancedToggle = this.container.querySelector("#advanced-toggle");
      this.deleteButton = this.container.querySelector("#provider-delete");
      this.testButton = this.container.querySelector("#provider-test");
      this.grsSettings = this.container.querySelector("#grs-settings");
      this.aliyunSettings = this.container.querySelector("#aliyun-settings");
      this.container.querySelector("#provider-new").addEventListener("click", () => this.newProvider());
      this.container.querySelector("#provider-delete").addEventListener("click", () => this.deleteProvider());
      this.container.querySelector("#provider-save").addEventListener("click", () => this.saveProvider());
      this.container.querySelector("#provider-test").addEventListener("click", () => this.testProvider());
      this.list.addEventListener("change", () => this.loadSelected());
      this.field("provider-type").addEventListener("change", () => this.handleProviderTypeChange());
      this.field("provider-auth-type").addEventListener("change", () => this.syncFieldVisibility());
      this.field("model-add").addEventListener("click", () => this.addManagedModel());
      this.field("grs-node").addEventListener("change", () => this.syncGrsFields());
      this.field("grs-custom-base-url").addEventListener("input", () => this.syncGrsFields());
      this.field("grs-model").addEventListener("change", () => { this.syncGrsFields(); if (this.uiStateStore) this.uiStateStore.setModel("grs", this.field("grs-model").value, "settings"); });
      this.field("grs-refresh-credits").addEventListener("click", () => this.refreshGrsCredits());
      this.field("aliyun-region").addEventListener("change", () => this.syncAliyunFields());
      this.field("aliyun-workspace-id").addEventListener("input", () => this.syncAliyunFields());
      this.field("aliyun-model").addEventListener("change", () => {
        this.syncAliyunFields({ notifyFallback: true });
        if (this.uiStateStore) this.uiStateStore.setModel("aliyun-bailian", this.field("aliyun-model").value, "settings");
      });
      this.field("provider-api-key").addEventListener("input", () => this.markKeyEdited("provider-api-key"));
      this.field("grs-api-key").addEventListener("input", () => this.markKeyEdited("grs-api-key"));
      this.field("aliyun-api-key").addEventListener("input", () => this.markKeyEdited("aliyun-api-key"));
      this.field("provider-remember-key").addEventListener("change", () => this.handleRememberChange("provider-remember-key"));
      this.field("grs-remember-key").addEventListener("change", () => this.handleRememberChange("grs-remember-key"));
      this.field("aliyun-remember-key").addEventListener("change", () => this.handleRememberChange("aliyun-remember-key"));
      this.field("provider-clear-key").addEventListener("click", () => this.clearCurrentKey(false));
      this.field("grs-clear-key").addEventListener("click", () => this.clearCurrentKey(true));
      this.field("aliyun-clear-key").addEventListener("click", () => this.clearCurrentKey(false, true));
      this.advancedToggle.addEventListener("click", () => this.toggleAdvanced());
      this.field("match-main-size").checked = Boolean(this.uiStateStore && this.uiStateStore.getMatchMainSize());
      this.field("match-main-size").addEventListener("change", () => { if (this.uiStateStore) this.uiStateStore.setMatchMainSize(this.field("match-main-size").checked, "settings"); });
      this.mountStorageManager();
      if (this.uiStateStore) this.unsubscribeUiState = this.uiStateStore.subscribe((change) => {
        if (change.type === "model" && change.providerId === "grs" && this.field("grs-model") && this.field("grs-model").value !== change.modelId) {
          this.field("grs-model").value = change.modelId; this.syncGrsFields();
        }
        if (change.type === "model" && change.providerId === "aliyun-bailian" && this.field("aliyun-model") && this.field("aliyun-model").value !== change.modelId) {
          this.field("aliyun-model").value = change.modelId; this.syncAliyunFields({ notifyFallback: true });
        }
        if (change.type === "matchMainSize") this.field("match-main-size").checked = change.value;
      });
      this.mountTooltips();
      this.refreshList();
      this.newProvider();
      this.sync();
      root.PSAIImageHubCompat.enhanceSelects(this.container);
    }

    toggle() { this.expanded = !this.expanded; this.sync(); }
    sync() { this.container.hidden = !this.expanded; if (this.toggleButton) this.toggleButton.setAttribute("aria-expanded", String(this.expanded)); }
    field(id) { return this.container.querySelector("#" + id); }

    mountStorageManager() {
      if (!this.storageManager) { this.field("storage-usage").textContent = this.t("storageUnavailable"); return; }
      this.field("copy-storage-path").addEventListener("click", () => this.copyStoragePath());
      this.field("refresh-storage").addEventListener("click", () => this.refreshStorageUsage());
      var actions = [
        ["clear-temp-cache", ["temporaryInputs"], "confirmClearTemporaryInputs"],
        ["clear-recovery-images", ["recoveryImages"], "confirmClearRecoveryImages"],
        ["clear-download-cache", ["downloads"], "confirmClearDownloadCache"],
        ["clear-history-images", ["historyImages"], "confirmClearHistoryImages"]
      ];
      actions.forEach((item) => this.field(item[0]).addEventListener("click", () => this.clearStorage(item[1], item[2])));
      this.field("clear-all-image-cache").addEventListener("click", () => this.clearStorage("all", "confirmClearAllImageCache"));
      this.field("clear-recovery-records").addEventListener("click", () => this.clearStorage("records", "confirmClearRecoveryRecords"));
      this.refreshStorageUsage();
    }

    async copyStoragePath() {
      var button = this.field("copy-storage-path"), path = this.storageManager.rootPath(), originalLabel = this.t("copyPath");
      this.field("storage-root-path").textContent = path;
      try {
        await root.PSAIImageHubCompat.copyText(path);
        button.textContent = this.t("copied"); this.field("storage-message").textContent = this.t("pathCopied");
        if (typeof root.setTimeout === "function") root.setTimeout(function restoreLabel() { button.textContent = originalLabel; }, 1400);
        return true;
      } catch (error) {
        button.textContent = originalLabel; this.field("storage-message").textContent = this.t("copyPathFailed");
        return false;
      }
    }

    refreshStorageUsage() {
      try {
        var report = this.storageManager.scan();
        this.field("storage-root-path").textContent = report.rootPath;
        if (report.unavailable) { this.field("storage-usage").textContent = this.t("storageUnavailable"); return; }
        this.field("storage-usage").innerHTML = buildStorageUsageMarkup(report, this.t);
        this.field("storage-message").textContent = "";
      } catch (error) { this.field("storage-message").textContent = this.t("storageScanFailed"); }
    }

    async clearStorage(target, confirmationKey) {
      if (root.confirm && !root.confirm(this.t(confirmationKey))) return;
      try {
        if (target === "all") this.storageManager.clearAllImages();
        else if (target === "records") this.storageManager.clearRecoveryRecords();
        else this.storageManager.clear(target);
        this.field("storage-message").textContent = this.t("storageClearDone"); this.refreshStorageUsage();
      } catch (error) { this.field("storage-message").textContent = this.t("storageClearFailed"); }
    }

    markKeyEdited(fieldId) {
      var input = this.field(fieldId);
      input.setAttribute("data-key-state", input.value ? root.PSAIImageHubCompat.KEY_UPDATED : root.PSAIImageHubCompat.KEY_UNCHANGED);
    }

    displaySecretStatus(providerId, prefix) {
      var status = this.providerManager.getApiKeyStatus(providerId);
      var input = this.field(prefix + "-api-key");
      input.value = "";
      input.placeholder = status.masked || this.t("apiKeyPlaceholder");
      input.setAttribute("data-key-state", root.PSAIImageHubCompat.KEY_UNCHANGED);
      this.field(prefix + "-remember-key").checked = status.remembered;
      this.field(prefix + "-key-status").textContent = status.remembered ? this.t("apiKeySavedLocally") : status.hasSecret ? this.t("apiKeySessionOnly") : this.t("apiKeyNotSet");
      this.field(prefix + "-clear-key").hidden = !status.hasSecret;
      this.forgetPersistentKey = false;
    }

    handleRememberChange(fieldId) {
      var checkbox = this.field(fieldId);
      if (checkbox.checked) { this.forgetPersistentKey = false; return; }
      var providerId = this.isGrsMode ? "grs" : this.isAliyunMode ? "aliyun-bailian" : this.editingId;
      if (!providerId || !this.providerManager.isApiKeyRemembered(providerId)) return;
      if (typeof root.confirm === "function" && !root.confirm(this.t("confirmStopRememberingApiKey"))) { checkbox.checked = true; return; }
      this.forgetPersistentKey = true;
    }

    clearCurrentKey(grsMode, aliyunMode) {
      var providerId = grsMode ? "grs" : aliyunMode ? "aliyun-bailian" : this.editingId;
      if (!providerId) return;
      if (typeof root.confirm === "function" && !root.confirm(this.t("confirmClearSavedApiKey"))) return;
      this.providerManager.clearProviderApiKey(providerId);
      this.displaySecretStatus(providerId, grsMode ? "grs" : aliyunMode ? "aliyun" : "provider");
      this.message.textContent = this.t("apiKeyCleared"); this.message.className = "status-completed";
    }

    toggleAdvanced() {
      this.advancedExpanded = !this.advancedExpanded;
      this.syncAdvancedSection();
    }

    syncAdvancedSection() {
      var visibility = getSettingsSectionVisibility(this.advancedExpanded);
      this.advancedFields.hidden = !visibility.advanced;
      this.advancedToggle.setAttribute("aria-expanded", String(visibility.advanced));
      this.advancedToggle.querySelector(".disclosure-mark").textContent = visibility.advanced ? "▾" : "▸";
    }

    syncFieldVisibility() {
      var type = this.field("provider-type").value;
      var visibility = getProviderFieldVisibility(type, this.field("provider-auth-type").value);
      this.container.querySelectorAll("[data-field]").forEach(function update(element) {
        element.hidden = visibility[element.getAttribute("data-field")] !== true;
      });
      this.container.querySelector("#provider-type-guide").textContent = type === "generic-rest" ? this.t("genericRestSteps") : type === "async-task" ? this.t("asyncTaskSteps") : "";
      var resultTypeVisibility = getResultTypeVisibility(type);
      Array.prototype.forEach.call(this.field("provider-result-type").options, function updateOption(option) {
        option.hidden = resultTypeVisibility[option.value] !== true;
        option.disabled = resultTypeVisibility[option.value] !== true;
      });
      if (!resultTypeVisibility[this.field("provider-result-type").value]) this.field("provider-result-type").value = type === "async-task" ? "task-id" : "auto";
      this.container.querySelector(".dynamic-endpoint-label").innerHTML = this.helpLabel(type === "async-task" ? "createEndpoint" : "endpoint", "helpEndpoint", "provider-endpoint");
      this.container.querySelector(".dynamic-response-label").innerHTML = this.helpLabel(type === "async-task" ? "taskIdPath" : "responsePath", type === "async-task" ? "helpTaskIdPath" : "helpResponsePath", "provider-response-path");
      this.bindTooltipButtons(this.container.querySelectorAll(".dynamic-endpoint-label .help-button, .dynamic-response-label .help-button"));
    }

    setBuiltInMode(mode) {
      this.isGrsMode = mode === "grs";
      this.isAliyunMode = mode === "aliyun-bailian";
      var builtIn = this.isGrsMode || this.isAliyunMode;
      this.container.querySelector(".settings-guide").hidden = builtIn;
      this.container.querySelector(".basic-section").hidden = builtIn;
      this.container.querySelector(".advanced-section").hidden = builtIn;
      this.grsSettings.hidden = !this.isGrsMode;
      this.aliyunSettings.hidden = !this.isAliyunMode;
      this.deleteButton.disabled = builtIn;
      this.testButton.hidden = false;
    }

    setGrsMode(enabled) { this.setBuiltInMode(enabled ? "grs" : "custom"); }

    syncGrsFields() {
      var node = this.field("grs-node").value;
      var model = root.PSAIImageHubCompat.getGrsModel(this.field("grs-model").value);
      this.field("grs-custom-base-field").hidden = node !== "custom";
      var sizes = model && Array.isArray(model.supportedImageSizes) ? model.supportedImageSizes : [];
      this.field("grs-image-size-field").hidden = !model || model.requestFamily !== "nano-banana" || !sizes.length;
      if (sizes.length) {
        var sizeSelect = this.field("grs-image-size"), previous = sizeSelect.value; sizeSelect.innerHTML = "";
        sizes.forEach(function add(size) { var option = document.createElement("option"); option.value = size; option.textContent = size; sizeSelect.appendChild(option); });
        if (sizes.indexOf(previous) !== -1) sizeSelect.value = previous;
      }
      var baseUrl = node === "china" ? "https://grsai.dakka.com.cn" : node === "custom" ? this.field("grs-custom-base-url").value || this.t("customBaseUrlNotSet") : "https://grsaiapi.com";
      this.field("grs-info-base-url").textContent = baseUrl;
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.field("grs-model"));
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.field("grs-image-size"));
    }

    syncAliyunFields(options) {
      var modelId = this.field("aliyun-model").value;
      var regionSelect = this.field("aliyun-region");
      var previousRegion = options && options.preferredRegion !== undefined
        ? String(options.preferredRegion || "") : regionSelect.value;
      var supportedRegions = root.PSAIImageHubCompat.getAliyunBailianSupportedRegions(modelId);
      var selectedRegion = root.PSAIImageHubCompat.resolveAliyunBailianSupportedRegion(modelId, previousRegion);
      regionSelect.innerHTML = "";
      supportedRegions.forEach(function addRegion(region) {
        var option = document.createElement("option");
        option.value = region.id;
        option.textContent = region.label;
        regionSelect.appendChild(option);
      });
      regionSelect.value = selectedRegion;
      if (options && options.notifyFallback && previousRegion && previousRegion !== selectedRegion) {
        var selected = supportedRegions.find(function match(region) { return region.id === selectedRegion; });
        this.message.textContent = this.t("aliyunRegionFallback", { region: selected && selected.label || selectedRegion });
        this.message.className = "status-completed";
      }
      var baseUrl = root.PSAIImageHubCompat.resolveAliyunBailianBaseUrl(selectedRegion, this.field("aliyun-workspace-id").value);
      this.field("aliyun-info-endpoint").textContent = baseUrl
        ? baseUrl + "/api/v1/services/aigc/image-generation/generation"
        : this.t("workspaceRequiredForEndpoint");
      root.PSAIImageHubCompat.refreshEnhancedSelect(regionSelect);
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.field("aliyun-model"));
    }

    handleProviderTypeChange() {
      if (this.field("provider-type").value === "async-task") this.field("provider-result-type").value = "task-id";
      this.syncFieldVisibility();
    }

    mountTooltips() {
      this.bindTooltipButtons(this.container.querySelectorAll(".help-button"));
      this.container.addEventListener("click", (event) => {
        if (!event.target.closest || !event.target.closest(".help-button")) this.hideTooltip();
      });
    }

    bindTooltipButtons(buttons) {
      Array.prototype.forEach.call(buttons, (button) => {
        if (button.getAttribute("data-help-bound") === "true") return;
        button.setAttribute("data-help-bound", "true");
        button.addEventListener("mouseenter", () => this.showTooltip(button, false));
        button.addEventListener("mouseleave", () => { if (!this.tooltipPinned) this.hideTooltip(); });
        button.addEventListener("focus", () => this.showTooltip(button, false));
        button.addEventListener("blur", () => { if (!this.tooltipPinned) this.hideTooltip(); });
        button.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          if (this.tooltipPinned && this.activeHelpButton === button) this.hideTooltip();
          else this.showTooltip(button, true);
        });
      });
    }

    showTooltip(button, pinned) {
      if (this.activeHelpButton && this.activeHelpButton !== button) this.activeHelpButton.setAttribute("aria-expanded", "false");
      this.activeHelpButton = button;
      this.tooltipPinned = pinned === true;
      button.setAttribute("aria-expanded", "true");
      this.tooltip.textContent = this.t(button.getAttribute("data-help-key"));
      this.tooltip.hidden = false;
      this.positionTooltip(button);
    }

    positionTooltip(button) {
      var rect = button.getBoundingClientRect();
      var viewportWidth = document.documentElement.clientWidth;
      var viewportHeight = document.documentElement.clientHeight;
      var width = Math.max(180, Math.min(280, viewportWidth - 20));
      this.tooltip.style.width = width + "px";
      var left = Math.max(10, Math.min(rect.right - width, viewportWidth - width - 10));
      var top = rect.bottom + 6;
      if (top + this.tooltip.offsetHeight > viewportHeight - 10) top = Math.max(10, rect.top - this.tooltip.offsetHeight - 6);
      this.tooltip.style.left = left + "px";
      this.tooltip.style.top = top + "px";
    }

    hideTooltip() {
      if (this.activeHelpButton) this.activeHelpButton.setAttribute("aria-expanded", "false");
      this.tooltip.hidden = true;
      this.tooltipPinned = false;
      this.activeHelpButton = null;
    }

    refreshList(selectedId) {
      this.list.innerHTML = "";
      (this.providerManager ? this.providerManager.listEditableProviderConfigs() : []).forEach((config) => {
        var option = document.createElement("option"); option.value = config.id; option.textContent = config.displayName; this.list.appendChild(option);
      });
      if (selectedId) this.list.value = selectedId;
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.list);
    }

    newProvider() {
      this.setGrsMode(false);
      this.list.selectedIndex = -1;
      this.editingId = root.PSAIImageHubCompat.createProviderId();
      this.field("provider-name").value = "";
      this.field("provider-type").value = "openai-compatible";
      ["provider-base-url", "provider-endpoint", "provider-api-key", "provider-custom-header", "provider-model", "provider-response-path", "provider-template", "provider-polling-endpoint", "provider-polling-path"].forEach((id) => { this.field(id).value = ""; });
      this.field("provider-remember-key").checked = false;
      this.field("provider-api-key").setAttribute("data-key-state", root.PSAIImageHubCompat.KEY_UNCHANGED);
      this.field("provider-key-status").textContent = this.t("apiKeyNotSet"); this.field("provider-clear-key").hidden = true;
      this.forgetPersistentKey = false;
      this.field("provider-auth-type").value = "bearer";
      this.field("provider-result-type").value = "auto";
      this.managedModels = [];
      this.renderManagedModels();
      this.advancedExpanded = false;
      this.message.textContent = "";
      this.syncAdvancedSection();
      this.syncFieldVisibility();
    }

    loadSelected() {
      var config = this.providerManager.getProviderConfig(this.list.value); if (!config) return;
      if (config.id === "grs" || config.type === "grs") { this.loadGrs(config); return; }
      if (config.id === "aliyun-bailian" || config.type === "aliyun-bailian") { this.loadAliyun(config); return; }
      this.setGrsMode(false);
      this.editingId = config.id;
      var values = { "provider-name": config.displayName, "provider-type": config.type, "provider-base-url": config.baseUrl,
        "provider-endpoint": config.endpointPath, "provider-auth-type": config.authType, "provider-custom-header": config.customHeaderName,
        "provider-model": config.modelId, "provider-result-type": config.resultType, "provider-response-path": config.responsePath,
        "provider-template": config.requestBodyTemplate, "provider-polling-endpoint": config.pollingEndpoint, "provider-polling-path": config.pollingResultPath };
      Object.keys(values).forEach((id) => { this.field(id).value = values[id] || ""; });
      this.displaySecretStatus(config.id, "provider");
      this.managedModels = Array.isArray(config.models) ? config.models.map(function copy(model) { return Object.assign({}, model); }) : [];
      this.renderManagedModels();
      this.advancedExpanded = false;
      this.syncAdvancedSection();
      this.syncFieldVisibility();
    }

    collectConfig() {
      var managedModels = this.collectManagedModels();
      var providerType = this.field("provider-type").value;
      var modelId = providerType === "generic-rest" ? managedModels[0] && managedModels[0].id || "" : this.field("provider-model").value;
      return root.PSAIImageHubCompat.normalizeProviderConfig({ id: this.editingId, displayName: this.field("provider-name").value,
        type: providerType, baseUrl: this.field("provider-base-url").value,
        endpointPath: this.field("provider-endpoint").value, authType: this.field("provider-auth-type").value,
        customHeaderName: this.field("provider-custom-header").value, modelId: modelId, models: managedModels,
        resultType: this.field("provider-result-type").value, responsePath: this.field("provider-response-path").value,
        requestBodyTemplate: this.field("provider-template").value, pollingEndpoint: this.field("provider-polling-endpoint").value,
        pollingResultPath: this.field("provider-polling-path").value });
    }

    renderManagedModels() {
      var container = this.field("provider-model-list");
      if (!container) return;
      container.innerHTML = "";
      (this.managedModels || []).forEach((model, index) => {
        var row = document.createElement("div"); row.className = "managed-model-row"; row.setAttribute("data-model-index", String(index));
        var name = document.createElement("input"); name.type = "text"; name.value = model.displayName || model.id; name.setAttribute("aria-label", this.t("modelDisplayName"));
        var id = document.createElement("input"); id.type = "text"; id.value = model.id; id.setAttribute("aria-label", "Model ID");
        var remove = document.createElement("button"); remove.type = "button"; remove.className = "compact-button"; remove.textContent = this.t("deleteModel");
        remove.addEventListener("click", () => { this.managedModels.splice(index, 1); this.renderManagedModels(); });
        row.appendChild(name); row.appendChild(id); row.appendChild(remove); container.appendChild(row);
      });
    }

    collectManagedModels() {
      var rows = this.field("provider-model-list") ? this.field("provider-model-list").querySelectorAll(".managed-model-row") : [];
      return Array.prototype.map.call(rows, function map(row) {
        var inputs = row.querySelectorAll("input");
        return { displayName: String(inputs[0].value || inputs[1].value).trim(), id: String(inputs[1].value || "").trim() };
      }).filter(function valid(model) { return !!model.id; });
    }

    addManagedModel() {
      var id = String(this.field("model-id").value || "").trim();
      if (!id) { this.showValidationError("errorModelIdRequired"); return; }
      var displayName = String(this.field("model-display-name").value || id).trim() || id;
      this.managedModels = this.collectManagedModels().filter(function different(model) { return model.id !== id; });
      this.managedModels.push({ id: id, displayName: displayName });
      this.field("model-id").value = ""; this.field("model-display-name").value = "";
      this.renderManagedModels();
    }

    loadGrs(config) {
      this.setGrsMode(true);
      this.editingId = "grs";
      this.field("grs-node").value = config.node || "global";
      this.field("grs-custom-base-url").value = config.customBaseUrl || "";
      this.displaySecretStatus("grs", "grs");
      this.field("grs-key-credits").textContent = "—";
      this.field("grs-model").value = this.uiStateStore && this.uiStateStore.getModel("grs") || config.modelId || "nano-banana-2";
      this.field("grs-image-size").value = config.imageSize || "1K";
      this.syncGrsFields();
      this.message.textContent = "";
    }

    collectGrsConfig() {
      return root.PSAIImageHubCompat.normalizeGrsConfig({
        node: this.field("grs-node").value,
        customBaseUrl: this.field("grs-custom-base-url").value,
        modelId: this.field("grs-model").value,
        imageSize: this.field("grs-image-size").value
      });
    }

    loadAliyun(config) {
      this.setBuiltInMode("aliyun-bailian");
      this.editingId = "aliyun-bailian";
      this.message.textContent = "";
      this.field("aliyun-workspace-id").value = config.workspaceId || "";
      this.displaySecretStatus("aliyun-bailian", "aliyun");
      this.field("aliyun-model").value = this.uiStateStore && this.uiStateStore.getModel("aliyun-bailian") || config.modelId || "qwen-image-3.0";
      this.field("aliyun-region").value = config.region || "cn-beijing";
      this.syncAliyunFields({ notifyFallback: true, preferredRegion: config.region || "cn-beijing" });
    }

    collectAliyunConfig() {
      return root.PSAIImageHubCompat.normalizeAliyunBailianConfig({
        region: this.field("aliyun-region").value,
        workspaceId: this.field("aliyun-workspace-id").value,
        modelId: this.field("aliyun-model").value
      });
    }

    validateAliyunForUi(config) {
      if (!config.region) return "errorBailianRegionRequired";
      if (!config.workspaceId) return "errorBailianWorkspaceRequired";
      var keyState = this.field("aliyun-api-key").getAttribute("data-key-state");
      var keyStatus = this.providerManager && typeof this.providerManager.getApiKeyStatus === "function"
        ? this.providerManager.getApiKeyStatus("aliyun-bailian") : { hasSecret: false };
      var hasKey = Boolean(this.field("aliyun-api-key").value || keyState !== "KEY_CLEARED" && keyStatus.hasSecret);
      return hasKey ? null : "errorBailianApiKeyRequired";
    }

    openForNew() {
      this.expanded = true;
      this.sync();
      this.newProvider();
      this.container.scrollTop = 0;
    }

    validateConfigForUi(config) {
      var existing = this.providerManager && this.providerManager.getProviderConfig(this.editingId);
      return getConfigValidationKey(config, Boolean(this.field("provider-api-key").value || existing));
    }

    showError(error) { this.message.textContent = root.PSAIImageHubCompat.toUserMessage(error, this.t); this.message.className = "status-failed"; }
    showValidationError(key) { this.message.textContent = this.t(key); this.message.className = "status-failed"; }

    saveProvider() {
      try {
        if (this.isAliyunMode) {
          var aliyunConfig = this.collectAliyunConfig();
          var aliyunValidationKey = this.validateAliyunForUi(aliyunConfig);
          if (aliyunValidationKey) { this.showValidationError(aliyunValidationKey); return; }
          var aliyunProvider = this.providerManager.saveProviderConfig(aliyunConfig, this.field("aliyun-api-key").value, { remember: this.field("aliyun-remember-key").checked, keyAction: this.field("aliyun-api-key").getAttribute("data-key-state"), forgetPersistent: this.forgetPersistentKey });
          this.refreshList("aliyun-bailian"); this.onProvidersChanged("aliyun-bailian"); this.displaySecretStatus("aliyun-bailian", "aliyun"); this.message.textContent = this.t("apiServiceSaved"); this.message.className = "status-completed"; return;
        }
        if (this.isGrsMode) {
          var grsProvider = this.providerManager.saveProviderConfig(this.collectGrsConfig(), this.field("grs-api-key").value, { remember: this.field("grs-remember-key").checked, keyAction: this.field("grs-api-key").getAttribute("data-key-state"), forgetPersistent: this.forgetPersistentKey });
          this.refreshList("grs"); this.onProvidersChanged("grs"); this.displaySecretStatus("grs", "grs"); this.message.textContent = this.t("apiServiceSaved"); this.message.className = "status-completed"; return;
        }
        var config = this.collectConfig();
        var validationKey = this.validateConfigForUi(config);
        if (validationKey) { this.showValidationError(validationKey); return; }
        var provider = this.providerManager.saveProviderConfig(config, this.field("provider-api-key").value, { remember: this.field("provider-remember-key").checked, keyAction: this.field("provider-api-key").getAttribute("data-key-state"), forgetPersistent: this.forgetPersistentKey });
        this.refreshList(provider.id); this.onProvidersChanged(provider.id); this.displaySecretStatus(provider.id, "provider"); this.message.textContent = this.t("apiServiceSaved"); this.message.className = "status-completed";
      } catch (error) { this.showError(error); }
    }

    async testProvider() {
      try {
        if (this.isAliyunMode) {
          var aliyunConfig = this.collectAliyunConfig();
          var aliyunValidationKey = this.validateAliyunForUi(aliyunConfig);
          if (aliyunValidationKey) { this.showValidationError(aliyunValidationKey); return; }
          await this.providerManager.testProviderConfig(aliyunConfig, this.field("aliyun-api-key").value);
          this.message.textContent = this.t("configValidationPassedNoFreeEndpoint"); this.message.className = "status-completed"; return;
        }
        if (this.isGrsMode) {
          var grsConfig = this.collectGrsConfig();
          var existingGrs = this.providerManager.getProviderConfig("grs");
          if (!this.field("grs-api-key").value && !existingGrs) { this.showValidationError("errorMissingApiKey"); return; }
          await this.providerManager.testProviderConfig(grsConfig, this.field("grs-api-key").value);
          this.message.textContent = this.t("configValidationPassedNoFreeEndpoint"); this.message.className = "status-completed"; return;
        }
        var config = this.collectConfig();
        var validationKey = this.validateConfigForUi(config);
        if (validationKey) { this.showValidationError(validationKey); return; }
        await this.providerManager.testProviderConfig(config, this.field("provider-api-key").value);
        this.message.textContent = this.t("configValidationPassedNoFreeEndpoint"); this.message.className = "status-completed";
      } catch (error) { this.showError(error); }
    }

    async refreshGrsCredits() {
      var output = this.field("grs-key-credits");
      try {
        output.textContent = this.t("querying");
        var result = await this.providerManager.getGrsApiKeyCredits(this.collectGrsConfig(), this.field("grs-api-key").value);
        output.textContent = this.t("creditsValue", { value: result.credits });
      } catch (error) { output.textContent = this.t("creditsQueryFailed"); }
    }

    deleteProvider() {
      if (!this.list.value) return;
      this.providerManager.deleteProviderConfig(this.list.value); this.refreshList(); this.newProvider(); this.onProvidersChanged(); this.message.textContent = this.t("apiServiceDeleted");
    }
  }

  return {
    SettingsPanel: SettingsPanel,
    PROVIDER_TOOLTIP_KEYS: TOOLTIP_KEYS,
    getProviderFieldVisibility: getProviderFieldVisibility,
    getResultTypeVisibility: getResultTypeVisibility,
    getSettingsSectionVisibility: getSettingsSectionVisibility,
    getConfigValidationKey: getConfigValidationKey,
    buildStorageUsageMarkup: buildStorageUsageMarkup
  };
}));
