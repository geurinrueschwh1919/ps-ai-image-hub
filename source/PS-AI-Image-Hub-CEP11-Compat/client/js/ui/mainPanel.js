(function defineMainPanel(root, factory) {
  "use strict";
  var api = factory(root.PSAIImageHubCompat, root.PSAIImageHubCompat, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createMainPanel(views, errors, root) {
  "use strict";
  var FOLLOW_REFERENCE = "__reference__";
  var FOLLOW_MAIN = "__main__";
  var FOLLOW_CANVAS = "__canvas__";
  var TAB_IDS = Object.freeze(["generate", "settings", "history"]);

  function applySelectionEditConstraint(prompt, mainImage, enabled, constraintText) {
    var source = String(prompt || "").trim();
    var constraint = String(constraintText || "").trim();
    if (!source || !enabled || !mainImage || mainImage.sourceType !== "current-selection" || !constraint) return source;
    if (source.indexOf(constraint) !== -1) return source;
    return source + "\n\n" + constraint;
  }

  function optionMarkup(value, label) {
    var option = document.createElement("option"); option.value = value; option.textContent = label; return option;
  }

  function updateRecoveryAction(panel, task) {
    var hasTask = Boolean(task && task.id);
    panel.recoverButton.hidden = !hasTask;
    if (hasTask) panel.recoverButton.textContent = panel.t("recoverTask", { id: task.id });
    return hasTask;
  }

  function getProviderOptionVisibility(provider, model) {
    var isBailian = Boolean(provider && provider.id === "aliyun-bailian");
    return {
      supportsNegative: Boolean(model && model.supportsNegativePrompt),
      supportsPromptExtend: Boolean(isBailian && model && model.supportsPromptExtend),
      supportsThinking: Boolean(isBailian && model && model.supportsThinking),
      supportsSeed: Boolean(model && model.supportsSeed),
      temporaryResultUrls: Boolean(isBailian && model && model.temporaryResultUrls),
      showsBillingNotice: Boolean(isBailian && model && model.showsBillingNotice)
    };
  }

  function parseOutputDimensions(value) {
    var match = String(value || "").match(/^(\d+)\s*[x*]\s*(\d+)$/i);
    if (!match) return null;
    var width = Number(match[1]), height = Number(match[2]);
    return width > 0 && height > 0 ? { width: width, height: height } : null;
  }

  function expectedOutputDimensions(model, aspectRatio, resolutionTier) {
    if (!model) return null;
    var mapping = model.resolutionTiersByAspectRatio && model.resolutionTiersByAspectRatio[String(aspectRatio || "")];
    var mapped = mapping && mapping[String(resolutionTier || "")];
    return parseOutputDimensions(mapped) || parseOutputDimensions(aspectRatio);
  }

  function calculateImportUpscaleRisk(output, target) {
    if (!output || !target) return null;
    var scale = Math.min(Number(target.width) / Number(output.width), Number(target.height) / Number(output.height));
    if (!(isFinite(scale) && scale > 1)) return null;
    return { scale: scale, level: scale <= 1.25 ? "mild" : scale <= 2 ? "medium" : "high" };
  }

  function importDocumentsMatch(metadata, context) {
    if (!metadata || !context || !(Number(context.documentWidth) > 0 && Number(context.documentHeight) > 0)) return null;
    return Math.abs(Number(metadata.width) - Number(context.documentWidth)) < 0.5 &&
      Math.abs(Number(metadata.height) - Number(context.documentHeight)) < 0.5;
  }

  function historyImportOptions(context, matches) {
    if (!context || context.importSizingEnabled !== true || !context.targetBounds) {
      return { matchMainSize: false, historyReimportUsedSavedContext: false,
        currentDocumentMatchesSavedImportContext: matches };
    }
    return { matchMainSize: true,
      mainTarget: { sourceType: context.mainSourceType || "history-import-context", bounds: context.targetBounds,
        documentBounds: { left: 0, top: 0, right: Number(context.documentWidth), bottom: Number(context.documentHeight),
          width: Number(context.documentWidth), height: Number(context.documentHeight) },
        width: Number(context.targetWidth) || Number(context.targetBounds.width),
        height: Number(context.targetHeight) || Number(context.targetBounds.height) },
      mainDimensions: { width: Number(context.targetWidth) || Number(context.targetBounds.width),
        height: Number(context.targetHeight) || Number(context.targetBounds.height) },
      historyReimportUsedSavedContext: true,
      currentDocumentMatchesSavedImportContext: matches };
  }

  class MainPanel {
    constructor(dependencies) {
      this.root = dependencies.root;
      this.providerManager = dependencies.providerManager;
      this.generationManager = dependencies.generationManager;
      this.photoshopBridge = dependencies.photoshopBridge;
      this.referenceImageManager = dependencies.referenceImageManager;
      this.historyStore = dependencies.historyStore;
      this.uiStateStore = dependencies.uiStateStore || null;
      this.recoveryStore = dependencies.recoveryStore || null;
      this.storageManager = dependencies.storageManager || null;
      this.promptPresetRegistry = dependencies.promptPresetRegistry || null;
      this.promptPresetCompiler = dependencies.promptPresetCompiler || null;
      this.promptPresetStack = dependencies.promptPresetStack || null;
      this.compatFileDialog = dependencies.compatFileDialog || null;
      this.cepCapabilities = dependencies.cepCapabilities || {};
      this.hostCapabilities = dependencies.hostCapabilities || {};
      this.storagePersistent = dependencies.storagePersistent !== false;
      this.t = dependencies.t;
      this.isGenerating = false;
      this.isImporting = false;
      this.busyOperationCount = 0;
      this.currentUiExecutionId = null;
      this.restoredExecutionId = null;
      this.restoredHistoryId = null;
      this.restoredSnapshot = null;
      this.activeRecoveryTask = null;
      this.mainImage = null;
      this.references = [];
      this.documentMetadata = null;
      this.lastPresetMetadata = { presetIds: [], presetTitles: [] };
    }

    mount() {
      this.root.innerHTML = `
        <section class="panel-shell">
          <header class="app-header"><h1>${this.t("appTitle")}</h1><span class="phase-badge">v1.0.3</span></header>
          ${this.storagePersistent ? "" : '<p class="compat-warning">' + this.t("compatSessionStorageWarning") + "</p>"}
          <nav class="tab-bar" role="tablist"><button class="tab-button" data-tab="generate" role="tab" aria-selected="true" type="button">${this.t("generateTab")}</button><button class="tab-button" data-tab="settings" role="tab" aria-selected="false" type="button">${this.t("settings")}</button><button class="tab-button" data-tab="history" role="tab" aria-selected="false" type="button">${this.t("history")}</button></nav>
          <section id="tab-generate" class="tab-panel" data-tab-panel="generate" role="tabpanel">
          <section class="host-section"><h2>${this.t("photoshopStatus")}</h2><div class="host-line"><div id="host-status" class="host-status"></div><button id="refresh-host" class="compact-button" type="button">${this.t("refreshPhotoshop")}</button></div></section>
          <label class="field-label" for="provider-select">${this.t("apiService")}</label><select id="provider-select"></select>
          <label class="field-label" for="model-selector">${this.t("model")}</label><div id="model-selector"></div>
          <label class="field-label" for="prompt-input">${this.t("prompt")}</label><textarea id="prompt-input" rows="5" placeholder="${this.t("promptPlaceholder")}"></textarea>
          <div id="prompt-preset-container"></div>
          <section class="reference-section main-image-section">
            <div class="field-heading"><span class="field-label">${this.t("mainImage")}</span><button class="help-button" type="button" title="${this.t("mainImageHelp")}">?</button></div>
            <div class="reference-actions"><button id="main-local" type="button">${this.t("chooseImage")}</button><button id="main-canvas" type="button">${this.t("currentCanvas")}</button><button id="main-selection" type="button">${this.t("currentSelection")}</button></div>
            <div id="main-preview" class="image-input-list"><span class="muted">${this.t("mainImageEmpty")}</span></div>
            <label id="selection-prompt-constraint-field" class="inline-check" hidden><input id="selection-prompt-constraint" type="checkbox" checked /> ${this.t("selectionPromptConstraintToggle")}</label>
          </section>
          <section class="reference-section">
            <div class="field-heading"><span class="field-label">${this.t("referenceImage")}</span><button class="help-button" type="button" title="${this.t("referenceHelp")}">?</button></div>
            <div class="reference-actions"><button id="reference-local" type="button">${this.t("chooseImage")}</button><button id="reference-canvas" type="button">${this.t("currentCanvas")}</button><button id="reference-selection" type="button">${this.t("currentSelection")}</button></div>
            <div id="reference-preview" class="image-input-list"><span class="muted">${this.t("referenceEmpty")}</span></div>
          </section>
          <div id="aspect-ratio-field" title="${this.t("followReferenceHelp")}"><label class="field-label" for="aspect-ratio">${this.t("aspectRatio")}</label><select id="aspect-ratio"></select></div>
          <div id="image-size-field" hidden title="${this.t("outputResolutionHelp")}"><label class="field-label" for="image-size">${this.t("outputResolution")}</label><select id="image-size"></select></div>
          <div id="import-quality-warning" class="import-quality-warning" hidden></div>
          <section id="provider-generation-options" class="provider-generation-options" hidden>
            <label id="negative-prompt-field" hidden><span class="field-label">${this.t("negativePrompt")}</span><textarea id="negative-prompt" rows="3" placeholder="${this.t("negativePromptPlaceholder")}"></textarea></label>
            <label id="prompt-extend-field" class="inline-check" hidden><input id="prompt-extend" type="checkbox" checked /> ${this.t("promptExtend")}</label>
            <label id="prompt-extend-mode-field" hidden><span class="field-label">${this.t("promptExtendMode")}</span><select id="prompt-extend-mode"><option value="direct">${this.t("promptExtendDirect")}</option><option value="agent">${this.t("promptExtendAgent")}</option></select></label>
            <label id="thinking-field" class="inline-check" hidden><input id="enable-thinking" type="checkbox" checked /> ${this.t("enableThinking")}</label>
            <label id="seed-field" hidden><span class="field-label">Seed</span><input id="seed" type="number" min="0" max="2147483647" step="1" placeholder="${this.t("seedRandomPlaceholder")}" /></label>
            <p id="provider-options-notice" class="muted" hidden></p>
            <p id="temporary-result-hint" class="muted" hidden>${this.t("bailianTemporaryResultHint")}</p>
            <p id="provider-cost-hint" class="muted" hidden>${this.t("bailianCostHint")}</p>
          </section>
          <div class="check-list"><label><input id="auto-import" type="checkbox" checked /> ${this.t("autoImport")}</label></div>
          <div class="button-row"><button id="generate-button" class="primary-button" type="button">${this.t("generate")}</button><button id="cancel-generation" class="danger-button" type="button" hidden>${this.t("cancelGeneration")}</button></div>
          <div class="button-row"><button id="recover-task" type="button" title="${this.t("recoverOriginalTaskHelp")}" hidden>${this.t("recoverLastTask")}</button></div>
          <div id="recovery-input-notice" class="muted" hidden></div>
          <section class="output-section"><h2>${this.t("generationStatus")}</h2><div id="status-line" class="status-line"></div></section>
          <section class="output-section"><h2>${this.t("resultPreview")}</h2><div id="result-container" class="result-container"></div><button id="import-button" type="button" disabled>${this.t("importPhotoshop")}</button></section>
          </section>
          <section id="tab-settings" class="tab-panel" data-tab-panel="settings" role="tabpanel" hidden><div id="settings-container" class="settings-container"></div></section>
          <section id="tab-history" class="tab-panel" data-tab-panel="history" role="tabpanel" hidden><div id="history-container"></div></section>
        </section>`;

      this.providerSelect = this.root.querySelector("#provider-select"); this.promptInput = this.root.querySelector("#prompt-input");
      this.aspectRatio = this.root.querySelector("#aspect-ratio"); this.imageSizeField = this.root.querySelector("#image-size-field");
      this.imageSize = this.root.querySelector("#image-size"); this.autoImport = this.root.querySelector("#auto-import");
      this.importQualityWarning = this.root.querySelector("#import-quality-warning");
      this.providerOptions = this.root.querySelector("#provider-generation-options");
      this.negativePrompt = this.root.querySelector("#negative-prompt");
      this.promptExtend = this.root.querySelector("#prompt-extend"); this.promptExtendMode = this.root.querySelector("#prompt-extend-mode");
      this.enableThinking = this.root.querySelector("#enable-thinking"); this.seedInput = this.root.querySelector("#seed");
      this.providerOptionsNotice = this.root.querySelector("#provider-options-notice");
      this.generateButton = this.root.querySelector("#generate-button"); this.cancelButton = this.root.querySelector("#cancel-generation");
      this.recoverButton = this.root.querySelector("#recover-task"); this.importButton = this.root.querySelector("#import-button");
      this.recoveryNotice = this.root.querySelector("#recovery-input-notice");
      this.selectionConstraintField = this.root.querySelector("#selection-prompt-constraint-field");
      this.selectionConstraint = this.root.querySelector("#selection-prompt-constraint");
      this.selectionConstraint.checked = !this.uiStateStore || typeof this.uiStateStore.getSelectionPromptConstraint !== "function" || this.uiStateStore.getSelectionPromptConstraint();
      this.hostStatus = this.root.querySelector("#host-status"); this.mainPreview = this.root.querySelector("#main-preview"); this.referencePreview = this.root.querySelector("#reference-preview"); this.currentResult = null;
      this.statusView = new views.StatusView(this.root.querySelector("#status-line"), this.t);
      this.resultView = new views.ResultView(this.root.querySelector("#result-container"), this.t);
      this.modelSelector = new views.ModelSelector(this.root.querySelector("#model-selector"), {
        t: this.t, onChange: (modelId) => { if (this.uiStateStore) this.uiStateStore.setModel(this.providerSelect.value, modelId, "generate"); this.syncGenerationParameters(); },
        onCustomModel: (model) => {
          model.requestFamily = model.family;
          model.supportedAspectRatios = model.family === "nano-banana" ? root.PSAIImageHubCompat.GRS_STANDARD_RATIOS.slice() : root.PSAIImageHubCompat.GRS_GPT_MODELS[0].supportedAspectRatios.slice();
          model.supportedImageSizes = model.family === "nano-banana" ? root.PSAIImageHubCompat.GRS_IMAGE_SIZES.slice() : [];
          return this.providerManager.addRuntimeModel(this.providerSelect.value, model);
        }
      });
      this.modelSelector.mount();
      if (typeof views.PromptPresetPanel === "function" && this.promptPresetRegistry) {
        this.promptPresetPanel = new views.PromptPresetPanel(this.root.querySelector("#prompt-preset-container"), {
          registry: this.promptPresetRegistry, stack: this.promptPresetStack, compiler: this.promptPresetCompiler, promptInput: this.promptInput,
          cepFs: this.compatFileDialog,
          t: this.t, hasMainImage: () => Boolean(this.mainImage),
          onApplied: (metadata) => { this.lastPresetMetadata = metadata || { presetIds: [], presetTitles: [] }; }
        });
        this.promptPresetPanel.mount();
      }
      this.settingsPanel = new views.SettingsPanel(this.root.querySelector("#settings-container"), null, this.t, {
        embeddedTab: true, providerManager: this.providerManager, uiStateStore: this.uiStateStore, storageManager: this.storageManager,
        onProvidersChanged: (providerId) => { this.populateProviders(); if (providerId) this.providerSelect.value = providerId; this.populateModels(); }
      });
      this.populateProviders(); this.populateModels(); this.statusView.update("idle"); this.resultView.clear(); this.settingsPanel.mount();
      this.historyPanel = new views.HistoryPanel(this.root.querySelector("#history-container"), {
        historyStore: this.historyStore, t: this.t,
        onReimport: (entry) => this.reimportHistoryEntry(entry), onRestore: (entry) => this.restoreHistoryEntry(entry)
      });
      this.historyPanel.mount();
      root.PSAIImageHubCompat.enhanceSelects(this.root);
      this.root.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => this.activateTab(button.getAttribute("data-tab"))));
      this.providerSelect.addEventListener("change", () => this.handleProviderChange());
      this.aspectRatio.addEventListener("change", () => { this.syncResolutionOptions(); this.updateImportQualityWarning(); });
      this.imageSize.addEventListener("change", () => this.updateImportQualityWarning());
      this.promptExtend.addEventListener("change", () => this.syncProviderOptions());
      this.promptExtendMode.addEventListener("change", () => this.syncProviderOptions());
      this.promptInput.addEventListener("input", () => { this.lastPresetMetadata = { presetIds: [], presetTitles: [] }; });
      this.selectionConstraint.addEventListener("change", () => {
        if (this.uiStateStore && typeof this.uiStateStore.setSelectionPromptConstraint === "function") this.uiStateStore.setSelectionPromptConstraint(this.selectionConstraint.checked, "generate");
      });
      this.generateButton.addEventListener("click", () => this.handleGenerate());
      this.cancelButton.addEventListener("click", () => this.generationManager.cancelGeneration());
      this.recoverButton.addEventListener("click", () => this.handleRecover());
      this.importButton.addEventListener("click", () => this.handleManualImport());
      this.root.querySelector("#refresh-host").addEventListener("click", () => this.refreshHostInfo());
      this.root.querySelector("#main-local").addEventListener("click", () => this.setLocalMainImage());
      this.root.querySelector("#main-canvas").addEventListener("click", () => this.setPhotoshopMainImage("canvas"));
      this.root.querySelector("#main-selection").addEventListener("click", () => this.setPhotoshopMainImage("selection"));
      this.root.querySelector("#reference-local").addEventListener("click", () => this.addLocalReference());
      this.root.querySelector("#reference-canvas").addEventListener("click", () => this.addPhotoshopReference("canvas"));
      this.root.querySelector("#reference-selection").addEventListener("click", () => this.addPhotoshopReference("selection"));
      if (this.uiStateStore) this.unsubscribeUiState = this.uiStateStore.subscribe((change) => {
        if (change.type === "model" && change.providerId === this.providerSelect.value && this.modelSelector.getValue() !== change.modelId) this.populateModels(change.modelId);
        if (change.type === "matchMainSize") this.updateImportQualityWarning();
      });
      this.refreshHostInfo(); this.syncRecoveryButton();
    }

    setHostCapabilities(capabilities) {
      this.hostCapabilities = capabilities || {};
      if (this.autoImport && !this.hostCapabilities.layerImport) {
        this.autoImport.checked = false;
        this.autoImport.disabled = true;
        this.autoImport.title = this.t("compatUnsupported");
      }
      this.syncGenerationParameters();
      this.syncImportButton();
    }

    capabilityAvailable(name) {
      return Boolean(this.hostCapabilities && this.hostCapabilities[name]);
    }

    populateProviders() {
      var previous = this.providerSelect.value || this.lastProviderId; this.providerSelect.innerHTML = "";
      this.providerManager.listProviders().forEach((provider) => this.providerSelect.appendChild(optionMarkup(provider.id, provider.displayName)));
      this.providerSelect.appendChild(optionMarkup("__new_api_service__", this.t("newApiServiceOption")));
      if (previous && this.providerManager.getProvider(previous)) this.providerSelect.value = previous;
      if (this.providerSelect.value !== "__new_api_service__") this.lastProviderId = this.providerSelect.value;
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.providerSelect);
    }

    populateModels(selectedId) {
      var providerId = this.providerSelect.value, provider = this.providerManager.getProvider(providerId);
      var preferred = selectedId || this.uiStateStore && this.uiStateStore.getModel(providerId) || provider && provider.config && provider.config.modelId;
      var families = providerId === "grs" ? [{ id: "nano-banana", displayName: this.t("grsNanoRequestFamily") }, { id: "gpt-image", displayName: this.t("grsGptRequestFamily") }] : [];
      this.modelSelector.setModels(this.providerManager.getModels(providerId), preferred, { customFamilies: families }); this.syncGenerationParameters(); this.syncRecoveryButton();
    }

    handleProviderChange() {
      if (this.providerSelect.value === "__new_api_service__") { this.providerSelect.value = this.lastProviderId || "mock"; this.settingsPanel.openForNew(); this.activateTab("settings"); root.PSAIImageHubCompat.refreshEnhancedSelect(this.providerSelect); return; }
      this.lastProviderId = this.providerSelect.value; this.populateModels();
    }

    setOptions(select, values) {
      var previous = select.value; select.innerHTML = "";
      values.forEach(function add(item) { select.appendChild(optionMarkup(typeof item === "string" ? item : item.value, typeof item === "string" ? item : item.label)); });
      if (Array.prototype.some.call(select.options, function match(option) { return option.value === previous; })) select.value = previous;
      root.PSAIImageHubCompat.refreshEnhancedSelect(select);
    }

    syncResolutionOptions(selectedModel) {
      var provider = this.providerManager.getProvider(this.providerSelect.value);
      var model = selectedModel || provider && provider.getModel(this.modelSelector.getValue());
      var sizes = model && model.resolutionTiersByAspectRatio && model.resolutionTiersByAspectRatio[this.aspectRatio.value]
        ? Object.keys(model.resolutionTiersByAspectRatio[this.aspectRatio.value])
        : model && (model.resolutionTiers || model.currentCatalogSupportedImageSizes || model.supportedImageSizes) || [];
      this.imageSizeField.hidden = !sizes.length;
      if (sizes.length) this.setOptions(this.imageSize, sizes.map(function option(value) {
        return { value: value, label: model && model.resolutionTierLabels && model.resolutionTierLabels[value] || value };
      }));
      if (typeof this.updateImportQualityWarning === "function") this.updateImportQualityWarning();
    }

    syncProviderOptions(selectedModel) {
      var provider = this.providerManager.getProvider(this.providerSelect.value);
      var currentModel = provider && provider.getModel(this.modelSelector.getValue());
      var model = currentModel || selectedModel && provider && provider.getModel(selectedModel.id);
      var visibility = getProviderOptionVisibility(provider, model);
      var supportsNegative = visibility.supportsNegative;
      var supportsPromptExtend = visibility.supportsPromptExtend;
      var supportsThinking = visibility.supportsThinking;
      var supportsSeed = visibility.supportsSeed;
      var hasOptions = supportsNegative || supportsPromptExtend || supportsThinking || supportsSeed;
      this.providerOptions.hidden = !hasOptions;
      this.root.querySelector("#negative-prompt-field").hidden = !supportsNegative;
      this.root.querySelector("#prompt-extend-field").hidden = !supportsPromptExtend;
      this.root.querySelector("#prompt-extend-mode-field").hidden = !supportsPromptExtend;
      this.root.querySelector("#thinking-field").hidden = !supportsThinking;
      this.root.querySelector("#seed-field").hidden = !supportsSeed;
      this.root.querySelector("#temporary-result-hint").hidden = !visibility.temporaryResultUrls;
      this.root.querySelector("#provider-cost-hint").hidden = !visibility.showsBillingNotice;
      this.enableThinking.disabled = !supportsThinking || !this.promptExtend.checked;
      var hasImages = Boolean(this.mainImage || this.references.length);
      var agentOption = this.promptExtendMode.querySelector('option[value="agent"]');
      if (agentOption) agentOption.disabled = hasImages;
      if (hasImages && this.promptExtendMode.value === "agent") {
        this.promptExtendMode.value = "direct";
        this.providerOptionsNotice.hidden = false;
        this.providerOptionsNotice.textContent = this.t("promptExtendAgentFallback");
      } else {
        this.providerOptionsNotice.hidden = true;
        this.providerOptionsNotice.textContent = "";
      }
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.promptExtendMode);
    }

    syncGenerationParameters() {
      var provider = this.providerManager.getProvider(this.providerSelect.value), model = provider && provider.getModel(this.modelSelector.getValue());
      var previousRatio = this.aspectRatio.value;
      var ratios = model && model.supportedAspectRatios && model.supportedAspectRatios.length ? model.supportedAspectRatios.slice() : ["1:1", "4:3", "3:4", "16:9", "9:16"];
      if (provider && provider.id === "grs") {
        ratios.unshift({ value: FOLLOW_CANVAS, label: this.t("followCurrentCanvas") });
        if (this.references.length) ratios.unshift({ value: FOLLOW_REFERENCE, label: this.t("followReference") });
        if (this.mainImage) ratios.unshift({ value: FOLLOW_MAIN, label: this.t("followMainImage") });
      }
      this.setOptions(this.aspectRatio, ratios);
      // A text-only GRS request must not implicitly depend on Photoshop document metadata.
      if (!previousRatio && provider && provider.id === "grs" && model && Array.isArray(model.supportedAspectRatios) && model.supportedAspectRatios.length) {
        this.aspectRatio.value = model.supportedAspectRatios.indexOf("auto") !== -1 ? "auto" : model.supportedAspectRatios[0];
        root.PSAIImageHubCompat.refreshEnhancedSelect(this.aspectRatio);
      }
      this.syncResolutionOptions(model);
      if (typeof this.syncProviderOptions === "function") this.syncProviderOptions(model);
      var supportsReferences = Boolean(provider && provider.getCapabilities && provider.getCapabilities().supportsImageToImage);
      var hostCapabilities = this.hostCapabilities || {};
      var localAvailable = Boolean(this.cepCapabilities && this.cepCapabilities.hasFileDialog && this.compatFileDialog && this.compatFileDialog.available);
      var availability = {
        "#main-local": localAvailable,
        "#reference-local": localAvailable,
        "#main-canvas": Boolean(hostCapabilities.currentCanvasExport),
        "#reference-canvas": Boolean(hostCapabilities.currentCanvasExport),
        "#main-selection": Boolean(hostCapabilities.currentSelectionExport),
        "#reference-selection": Boolean(hostCapabilities.currentSelectionExport)
      };
      Object.keys(availability).forEach((selector) => {
        var button = this.root.querySelector(selector);
        button.disabled = !supportsReferences || !availability[selector] || this.isGenerating;
        button.title = availability[selector] ? "" : this.t("compatUnsupported");
      });
      if (typeof this.updateImportQualityWarning === "function") this.updateImportQualityWarning();
    }

    warningAspectRatio(model) {
      var selected = this.aspectRatio && this.aspectRatio.value;
      if (selected === FOLLOW_MAIN && this.mainImage) return root.PSAIImageHubCompat.resolveAspectRatio(this.mainImage.width, this.mainImage.height, model.supportedAspectRatios);
      if (selected === FOLLOW_REFERENCE && this.references[0]) return root.PSAIImageHubCompat.resolveAspectRatio(this.references[0].width, this.references[0].height, model.supportedAspectRatios);
      if (selected === FOLLOW_CANVAS && this.documentMetadata) return root.PSAIImageHubCompat.resolveAspectRatio(this.documentMetadata.width, this.documentMetadata.height, model.supportedAspectRatios);
      return selected;
    }

    updateImportQualityWarning() {
      if (!this.importQualityWarning) return null;
      var enabled = Boolean(this.uiStateStore && this.uiStateStore.getMatchMainSize());
      var provider = this.providerSelect && this.providerManager.getProvider(this.providerSelect.value);
      var model = provider && this.modelSelector && provider.getModel(this.modelSelector.getValue());
      var ratio = model ? this.warningAspectRatio(model) : null;
      var output = expectedOutputDimensions(model, ratio, this.imageSize && this.imageSize.value);
      var risk = enabled && this.mainImage ? calculateImportUpscaleRisk(output, this.mainImage) : null;
      this.importQualityWarning.hidden = !risk;
      this.importQualityWarning.className = "import-quality-warning" + (risk ? " import-risk-" + risk.level : "");
      this.importQualityWarning.textContent = risk ? this.t("importUpscaleRisk_" + risk.level, { scale: risk.scale.toFixed(2) }) : "";
      return risk;
    }

    async resolveRequestedAspectRatio(model) {
      if (!model || !model.supportedAspectRatios || !model.supportedAspectRatios.length) return this.aspectRatio.value;
      if (this.aspectRatio.value === FOLLOW_REFERENCE) {
        var reference = this.references[0];
        return reference ? root.PSAIImageHubCompat.resolveAspectRatio(reference.width, reference.height, model.supportedAspectRatios) || model.supportedAspectRatios[0] : model.supportedAspectRatios[0];
      }
      if (this.aspectRatio.value === FOLLOW_MAIN) {
        return this.mainImage ? root.PSAIImageHubCompat.resolveAspectRatio(this.mainImage.width, this.mainImage.height, model.supportedAspectRatios) || model.supportedAspectRatios[0] : model.supportedAspectRatios[0];
      }
      if (this.aspectRatio.value === FOLLOW_CANVAS) {
        var metadata = this.documentMetadata || await this.referenceImageManager.getCurrentDocumentMetadata();
        return root.PSAIImageHubCompat.resolveAspectRatio(metadata.width, metadata.height, model.supportedAspectRatios) || model.supportedAspectRatios[0];
      }
      return this.aspectRatio.value;
    }

    replaceMainImage(image) { if (this.mainImage) this.referenceImageManager.remove(this.mainImage); this.mainImage = image || null; this.renderMainImage(); this.syncGenerationParameters(); if (this.promptPresetPanel) this.promptPresetPanel.refreshContext(); }
    addReference(reference) {
      if (!reference) return;
      if (this.references.length >= root.PSAIImageHubCompat.MAX_REFERENCE_IMAGES) { this.referenceImageManager.remove(reference); this.statusView.update("failed", { message: this.t("referenceLimit", { count: root.PSAIImageHubCompat.MAX_REFERENCE_IMAGES }) }); return; }
      this.references.push(reference); this.renderReferences(); this.syncGenerationParameters();
    }
    removeReferenceAt(index) { var removed = this.references.splice(index, 1)[0]; this.referenceImageManager.remove(removed); this.renderReferences(); this.syncGenerationParameters(); }
    moveReference(index, direction) { this.references = root.PSAIImageHubCompat.moveReferenceImage(this.references, index, index + direction); this.renderReferences(); }
    createImageCard(reference, options) {
      var card = document.createElement("div"); card.className = "reference-preview";
      var image = document.createElement("img"); image.src = reference.previewSource; image.alt = options.alt;
      var info = document.createElement("div"); info.className = "reference-info"; info.textContent = this.t("referenceMetadata", { source: this.t("referenceSource_" + reference.sourceLabel), width: reference.width || "?", height: reference.height || "?" });
      var actions = document.createElement("div"); actions.className = "image-card-actions";
      if (options.index !== undefined) {
        var up = document.createElement("button"); up.type = "button"; up.className = "icon-button"; up.textContent = "↑"; up.disabled = options.index === 0; up.addEventListener("click", () => this.moveReference(options.index, -1));
        var down = document.createElement("button"); down.type = "button"; down.className = "icon-button"; down.textContent = "↓"; down.disabled = options.index === this.references.length - 1; down.addEventListener("click", () => this.moveReference(options.index, 1));
        actions.appendChild(up); actions.appendChild(down);
      }
      var remove = document.createElement("button"); remove.type = "button"; remove.className = "compact-button"; remove.textContent = this.t("removeReference"); remove.addEventListener("click", options.onRemove);
      actions.appendChild(remove); card.appendChild(image); card.appendChild(info); card.appendChild(actions); return card;
    }
    renderMainImage() {
      this.mainPreview.innerHTML = "";
      this.selectionConstraintField.hidden = !(this.mainImage && this.mainImage.sourceType === "current-selection");
      if (!this.mainImage) { this.mainPreview.innerHTML = '<span class="muted">' + this.t("mainImageEmpty") + "</span>"; return; }
      this.mainPreview.appendChild(this.createImageCard(this.mainImage, { alt: this.t("mainImage"), onRemove: () => this.replaceMainImage(null) }));
    }
    renderReferences() {
      this.referencePreview.innerHTML = "";
      if (!this.references.length) { this.referencePreview.innerHTML = '<span class="muted">' + this.t("referenceEmpty") + "</span>"; return; }
      this.references.forEach((reference, index) => this.referencePreview.appendChild(this.createImageCard(reference, { alt: this.t("referenceImage"), index: index, onRemove: () => this.removeReferenceAt(index) })));
    }
    replaceReference(reference) { this.references.slice().forEach((item) => this.referenceImageManager.remove(item)); this.references = reference ? [reference] : []; this.renderReferences(); }
    renderReference() {
      this.renderReferences();
    }
    cleanupTransientInputFiles() {
      if (this.mainImage && this.mainImage.transient) { this.referenceImageManager.remove(this.mainImage); this.mainImage.transient = false; this.mainImage.sourceLabel = this.mainImage.sourceLabel || "task-snapshot"; }
      this.references.forEach((reference) => { if (reference && reference.transient) { this.referenceImageManager.remove(reference); reference.transient = false; } });
    }
    async setLocalMainImage() { try { if (!this.cepCapabilities.hasFileDialog) throw new Error(this.t("compatUnsupported")); var value = this.referenceImageManager.chooseLocalImage(this.t("chooseMainImage")); if (value) this.replaceMainImage(value); } catch (error) { this.statusView.update("failed", { message: errors.toUserMessage(error, this.t) }); } }
    async setPhotoshopMainImage(mode) { try { var capability = mode === "selection" ? "currentSelectionExport" : "currentCanvasExport"; if (!this.capabilityAvailable(capability)) throw new Error(this.t("compatUnsupported")); this.replaceMainImage(await this.referenceImageManager.exportFromPhotoshop(mode)); } catch (error) { this.statusView.update("failed", { message: errors.toUserMessage(error, this.t) }); } }
    async addLocalReference() { try { if (!this.cepCapabilities.hasFileDialog) throw new Error(this.t("compatUnsupported")); var value = this.referenceImageManager.chooseLocalImage(this.t("chooseReferenceImage")); if (value) this.addReference(value); } catch (error) { this.statusView.update("failed", { message: errors.toUserMessage(error, this.t) }); } }
    async addPhotoshopReference(mode) { try { var capability = mode === "selection" ? "currentSelectionExport" : "currentCanvasExport"; if (!this.capabilityAvailable(capability)) throw new Error(this.t("compatUnsupported")); this.addReference(await this.referenceImageManager.exportFromPhotoshop(mode)); } catch (error) { this.statusView.update("failed", { message: errors.toUserMessage(error, this.t) }); } }

    setBusy(value) { this.isGenerating = value; this.syncControls(); }
    beginBusyOperation() { this.busyOperationCount += 1; this.setBusy(true); }
    endBusyOperation() { this.busyOperationCount = Math.max(0, this.busyOperationCount - 1); this.setBusy(this.busyOperationCount > 0); }
    activateTab(tabId) {
      var selected = TAB_IDS.indexOf(tabId) !== -1 ? tabId : "generate";
      this.root.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.getAttribute("data-tab-panel") !== selected; });
      this.root.querySelectorAll(".tab-button").forEach((button) => { button.setAttribute("aria-selected", String(button.getAttribute("data-tab") === selected)); });
      if (selected === "history" && this.historyPanel) this.historyPanel.refresh();
    }
    syncControls() {
      var busy = this.isGenerating || this.isImporting; this.generateButton.disabled = busy; this.providerSelect.disabled = busy; this.modelSelector.setDisabled(busy);
      this.generateButton.textContent = this.isGenerating ? this.t("generating") : this.t("generate"); this.cancelButton.hidden = !this.isGenerating;
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.providerSelect); this.syncGenerationParameters(); this.syncImportButton();
    }
    handlePipelineStatus(status, payload) {
      if (payload && payload.executionId && this.currentUiExecutionId && payload.executionId !== this.currentUiExecutionId) {
        if (root.PSAIImageHubCompat.logger) root.PSAIImageHubCompat.logger.warn("STALE_ASYNC_CALLBACK_IGNORED", {
          executionId: payload.executionId, currentExecutionId: this.currentUiExecutionId, callbackStatus: status
        });
        return;
      }
      if (status === "completed" && payload) { this.currentResult = payload; this.resultView.render(payload); }
      else if (payload && payload.result) { this.currentResult = payload.result; this.resultView.updateImportState(payload.result); }
      if (status === "importing") this.isImporting = true; if (status === "imported" || status === "importFailed") this.isImporting = false;
      this.statusView.update(status, payload); this.syncControls();
    }
    syncImportButton() {
      var state = this.currentResult ? this.currentResult.importState : null;
      if (!this.capabilityAvailable("layerImport")) { this.importButton.disabled = true; this.importButton.textContent = this.t("importPhotoshop"); this.importButton.title = this.t("compatUnsupported"); return; }
      this.importButton.title = "";
      if (!state) { this.importButton.disabled = true; this.importButton.textContent = this.t("importPhotoshop"); return; }
      if (state === "importing") { this.importButton.disabled = true; this.importButton.textContent = this.t("importingPhotoshop"); return; }
      if (state === "imported") { this.importButton.disabled = true; this.importButton.textContent = this.t("importedPhotoshop"); return; }
      this.importButton.disabled = this.isGenerating || this.isImporting; this.importButton.textContent = state === "failed" ? this.t("importAgain") : this.t("importPhotoshop");
    }

    async handleGenerate(options) {
      var action = options || {};
      var operationExecutionId = null;
      this.beginBusyOperation(); this.currentResult = null; this.resultView.clear(); this.syncImportButton();
      try {
        var provider = this.providerManager.getProvider(this.providerSelect.value), model = provider && provider.getModel(this.modelSelector.getValue());
        var finalPrompt = applySelectionEditConstraint(this.promptInput.value, this.mainImage, this.selectionConstraint.checked, this.t("selectionPromptConstraint"));
        var result = await this.generationManager.generateOneClick({ providerId: this.providerSelect.value, modelId: this.modelSelector.getValue(), prompt: finalPrompt,
          finalPrompt: finalPrompt,
          aspectRatio: await this.resolveRequestedAspectRatio(model), count: 1, resolutionTier: this.imageSizeField.hidden ? null : this.imageSize.value,
          imageSize: this.imageSizeField.hidden ? null : this.imageSize.value,
          replyType: provider && provider.executionMode === "async" || this.providerSelect.value === "grs" ? "async" : "json",
          imageInputs: { mainImage: this.mainImage, referenceImages: this.references.slice() },
          negativePrompt: this.negativePrompt.value,
          promptExtend: this.promptExtend.checked,
          promptExtendMode: this.promptExtendMode.value,
          enableThinking: this.enableThinking.checked,
          seed: this.seedInput.value,
          presetMetadata: { presetIds: (this.lastPresetMetadata.presetIds || []).slice(), presetTitles: (this.lastPresetMetadata.presetTitles || []).slice() },
          snapshotSourceExecutionId: action.snapshotRegeneration ? this.restoredExecutionId : null,
          matchMainSize: Boolean(this.uiStateStore && this.uiStateStore.getMatchMainSize()), autoImport: this.autoImport.checked },
        { onExecution: (execution) => { operationExecutionId = execution.executionId; this.currentUiExecutionId = execution.executionId; },
          onStatus: (status, payload) => this.handlePipelineStatus(status, payload) });
        if (result && (!operationExecutionId || operationExecutionId === this.currentUiExecutionId)) { this.currentResult = result; this.resultView.render(result); this.syncImportButton(); }
      } catch (error) {
        if (!operationExecutionId || operationExecutionId === this.currentUiExecutionId) {
          var message = typeof errors.toUserMessage === "function" ? errors.toUserMessage(error, this.t) : String(error && error.message || error || "");
          this.statusView.update(error.code === "CANCELLED" ? "cancelled" : "failed", { message: message });
        }
      }
      finally { this.endBusyOperation(); if (!this.busyOperationCount) this.cleanupTransientInputFiles(); this.syncRecoveryButton(); if (this.historyPanel) this.historyPanel.refresh(); }
    }

    syncRecoveryButton() {
      var provider = this.providerManager.getProvider(this.providerSelect.value);
      var task = this.activeRecoveryTask || provider && provider.getRecoverableTask && provider.getRecoverableTask();
      this.recoverableTask = task;
      updateRecoveryAction(this, task);
      if (task && this.recoveryStore && this.restoredTaskId !== task.id) this.restoreRecoveryInputs(task.id, true);
    }
    restoreRecoveryInputs(taskId, quiet) {
      if (!this.recoveryStore) return null;
      var snapshot = null;
      try { snapshot = this.recoveryStore.restoreSnapshot(taskId); }
      catch (error) { snapshot = null; }
      this.restoredTaskId = taskId;
      this.restoredSnapshot = snapshot;
      if (!snapshot) {
        this.recoveryNotice.hidden = false;
        this.recoveryNotice.textContent = this.t("recoverySnapshotUnavailable");
        return null;
      }
      var metadata = snapshot.metadata;
      this.restoredExecutionId = metadata.executionId || this.recoverableTask && this.recoverableTask.executionId || null;
      this.restoredHistoryId = metadata.historyId || this.recoverableTask && this.recoverableTask.historyId || null;
      if (this.providerManager.getProvider(metadata.providerId)) {
        this.providerSelect.value = metadata.providerId; this.populateModels(metadata.modelId); root.PSAIImageHubCompat.refreshEnhancedSelect(this.providerSelect);
      }
      this.promptInput.value = metadata.finalPrompt || metadata.prompt || "";
      this.mainImage = snapshot.mainImage || null; this.references = snapshot.referenceImages.slice();
      this.renderMainImage(); this.renderReferences(); this.syncGenerationParameters();
      if (this.promptPresetPanel) this.promptPresetPanel.refreshContext();
      if (metadata.aspectRatio && Array.prototype.some.call(this.aspectRatio.options, function match(option) { return option.value === metadata.aspectRatio; })) this.aspectRatio.value = metadata.aspectRatio;
      this.syncResolutionOptions();
      if (metadata.resolutionTier && Array.prototype.some.call(this.imageSize.options, function match(option) { return option.value === metadata.resolutionTier; })) this.imageSize.value = metadata.resolutionTier;
      if (this.negativePrompt) this.negativePrompt.value = metadata.negativePrompt || "";
      if (this.promptExtend && metadata.promptExtend !== undefined) this.promptExtend.checked = metadata.promptExtend !== false;
      if (this.promptExtendMode) this.promptExtendMode.value = metadata.promptExtendMode || "direct";
      if (this.enableThinking && metadata.enableThinking !== undefined) this.enableThinking.checked = metadata.enableThinking !== false;
      if (this.seedInput) this.seedInput.value = metadata.seed === undefined || metadata.seed === null ? "" : String(metadata.seed);
      if (typeof this.syncProviderOptions === "function") this.syncProviderOptions();
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.aspectRatio); root.PSAIImageHubCompat.refreshEnhancedSelect(this.imageSize);
      this.recoveryNotice.hidden = false;
      this.recoveryNotice.textContent = snapshot.imagesMissing ? this.t("recoverySnapshotPartiallyMissing") : this.t("recoverySnapshotRestored");
      if (!quiet) this.activateTab("generate");
      return snapshot;
    }
    async handleRecover() {
      if (!this.recoverableTask) return; this.beginBusyOperation();
      var operationExecutionId = null;
      var originalTask = this.recoverableTask;
      this.activeRecoveryTask = originalTask;
      try {
        var snapshot = this.restoreRecoveryInputs(originalTask.id, false);
        var main = snapshot && snapshot.mainImage;
        var metadata = snapshot && snapshot.metadata || {};
        var target = snapshot && (metadata.mainTarget || (metadata.mainTargetDimensions ? {
          sourceType: "recovery-snapshot", width: metadata.mainTargetDimensions.width, height: metadata.mainTargetDimensions.height
        } : null));
        var recoveryProviderId = originalTask.providerId || this.providerSelect && this.providerSelect.value || "grs";
        var recoveredResult = await this.generationManager.recoverProviderTask(recoveryProviderId, originalTask.id, { modelId: originalTask.modelId,
          prompt: metadata.finalPrompt || metadata.prompt, finalPrompt: metadata.finalPrompt || metadata.prompt,
          autoImport: this.autoImport.checked,
          aspectRatio: metadata.aspectRatio,
          imageSize: metadata.resolutionTier,
          imageInputs: snapshot ? { mainImage: snapshot.mainImage, referenceImages: Array.isArray(snapshot.referenceImages) ? snapshot.referenceImages.slice() : [] } : null,
          negativePrompt: metadata.negativePrompt,
          promptExtend: metadata.promptExtend,
          promptExtendMode: metadata.promptExtendMode,
          enableThinking: metadata.enableThinking,
          seed: metadata.seed,
          executionId: originalTask.executionId || metadata.executionId,
          historyId: originalTask.historyId || metadata.historyId,
          importOptions: { matchMainSize: Boolean(target || main) && Boolean(this.uiStateStore && this.uiStateStore.getMatchMainSize()),
            mainTarget: target, mainDimensions: target ? { width: target.width, height: target.height } : (main ? { width: main.width, height: main.height } : null) },
          onExecution: (execution) => { operationExecutionId = execution.executionId; this.currentUiExecutionId = execution.executionId; },
          onStatus: (status, payload) => this.handlePipelineStatus(status, payload) });
        if (recoveredResult && (!operationExecutionId || operationExecutionId === this.currentUiExecutionId)) {
          this.currentResult = recoveredResult; this.resultView.render(recoveredResult);
        }
      }
      catch (error) {
        if (!operationExecutionId || operationExecutionId === this.currentUiExecutionId) {
          var message = typeof errors.toUserMessage === "function" ? errors.toUserMessage(error, this.t) : String(error && error.message || error || "");
          this.statusView.update(error.code === "CANCELLED" ? "cancelled" : "failed", { message: message });
        }
      }
      finally { this.activeRecoveryTask = null; this.endBusyOperation(); this.syncRecoveryButton(); if (this.historyPanel) this.historyPanel.refresh(); }
    }
    async handleManualImport() {
      if (!this.currentResult) return;
      try { await this.generationManager.importGeneratedResult(this.currentResult, { onStatus: (status, payload) => this.handlePipelineStatus(status, payload) }); }
      catch (error) {} finally { this.isImporting = false; this.resultView.updateImportState(this.currentResult); this.syncControls(); }
    }
    async reimportHistoryEntry(entry) {
      if (!entry || (!entry.localResultFile && !entry.resultUrl)) return;
      var context = entry.importContext || null;
      var currentMetadata = null;
      var documentsMatch = null;
      if (context && Number(context.documentWidth) > 0 && Number(context.documentHeight) > 0) {
        try { currentMetadata = await this.photoshopBridge.getDocumentMetadata(); }
        catch (error) { currentMetadata = null; }
        documentsMatch = importDocumentsMatch(currentMetadata, context);
        if (documentsMatch !== true) {
          var warning = this.t("historyReimportDocumentMismatch", {
            saved: Number(context.documentWidth) + " × " + Number(context.documentHeight),
            current: currentMetadata ? Number(currentMetadata.width) + " × " + Number(currentMetadata.height) : this.t("unknownDocumentSize")
          });
          if (typeof root.confirm !== "function" || !root.confirm(warning)) return;
        }
      }
      var savedOptions = historyImportOptions(context, documentsMatch);
      var localMime = entry.localResultMimeType || (/\.jpe?g$/i.test(String(entry.localResultFile || "")) ? "image/jpeg" : "image/png");
      var historySource = entry.localResultFile
        ? { mimeType: localMime, previewSource: root.PSAIImageHubCompat.historyFileUrl(entry.localResultFile), importSource: { type: "local-file", path: entry.localResultFile } }
        : { mimeType: null, previewSource: entry.resultUrl, importSource: { type: "url", url: entry.resultUrl } };
      var result = { providerId: entry.provider, modelId: entry.modelId, prompt: entry.finalPrompt || entry.prompt, taskId: entry.taskId,
        historyId: entry.id,
        images: [Object.assign({ id: entry.id }, historySource)],
        importState: "notImported", importResult: null, importError: null, importOptions: savedOptions };
      if (root.PSAIImageHubCompat.logger) root.PSAIImageHubCompat.logger.info("HISTORY_REIMPORT_CONTEXT", {
        historyReimportUsedSavedContext: savedOptions.historyReimportUsedSavedContext === true,
        currentDocumentMatchesSavedImportContext: documentsMatch
      });
      try {
        await this.generationManager.importGeneratedResult(result, { onStatus: (status, payload) => this.handlePipelineStatus(status, payload) });
        this.historyStore.markImported(entry.id, result.importResult && result.importResult.importContext);
      }
      catch (error) {} finally { this.isImporting = false; this.historyPanel.refresh(); }
    }
    restoreHistoryEntry(entry) {
      if (!entry) return;
      this.lastPresetMetadata = { presetIds: [], presetTitles: [] };
      if (entry.taskId && this.recoveryStore) {
        try { this.restoreRecoveryInputs(entry.taskId, true); } catch (error) { /* History text parameters still restore below. */ }
      }
      if (this.providerManager.getProvider(entry.provider)) { this.providerSelect.value = entry.provider; this.populateModels(entry.modelId); root.PSAIImageHubCompat.refreshEnhancedSelect(this.providerSelect); }
      this.promptInput.value = entry.finalPrompt || entry.prompt || "";
      if (entry.aspectRatio && Array.prototype.some.call(this.aspectRatio.options, function match(option) { return option.value === entry.aspectRatio; })) this.aspectRatio.value = entry.aspectRatio;
      if (entry.imageSize && Array.prototype.some.call(this.imageSize.options, function match(option) { return option.value === entry.imageSize; })) this.imageSize.value = entry.imageSize;
      if (this.negativePrompt) this.negativePrompt.value = entry.negativePrompt || "";
      if (this.promptExtend && entry.promptExtend !== undefined) this.promptExtend.checked = entry.promptExtend !== false;
      if (this.promptExtendMode) this.promptExtendMode.value = entry.promptExtendMode || "direct";
      if (this.enableThinking && entry.enableThinking !== undefined) this.enableThinking.checked = entry.enableThinking !== false;
      if (this.seedInput) this.seedInput.value = entry.seed === undefined || entry.seed === null ? "" : String(entry.seed);
      if (typeof this.syncProviderOptions === "function") this.syncProviderOptions();
      root.PSAIImageHubCompat.refreshEnhancedSelect(this.aspectRatio); root.PSAIImageHubCompat.refreshEnhancedSelect(this.imageSize); this.activateTab("generate");
    }
    async refreshHostInfo() {
      this.hostStatus.textContent = this.t("bridgeChecking");
      if (!this.photoshopBridge.isAvailable()) { this.hostStatus.textContent = this.t("bridgeUnavailable"); return; }
      try {
        await this.photoshopBridge.ping(); var version = await this.photoshopBridge.getPhotoshopVersion(); var hasDocument = await this.photoshopBridge.hasOpenDocument();
        if (hasDocument) { this.documentMetadata = await this.photoshopBridge.getDocumentMetadata(); this.hostStatus.textContent = this.t("bridgeReadyDocument", { version: version, document: this.documentMetadata.name }); }
        else { this.documentMetadata = null; this.hostStatus.textContent = this.t("bridgeReadyNoDocument", { version: version }); }
      } catch (error) { this.hostStatus.textContent = errors.toUserMessage(error, this.t); }
    }
  }
  return { MainPanel: MainPanel, TAB_IDS: TAB_IDS, FOLLOW_MAIN: FOLLOW_MAIN, FOLLOW_REFERENCE: FOLLOW_REFERENCE,
    FOLLOW_CANVAS: FOLLOW_CANVAS, updateRecoveryAction: updateRecoveryAction, getProviderOptionVisibility: getProviderOptionVisibility,
    applySelectionEditConstraint: applySelectionEditConstraint, parseExpectedOutputDimensions: parseOutputDimensions,
    resolveExpectedOutputDimensions: expectedOutputDimensions, calculateImportUpscaleRisk: calculateImportUpscaleRisk,
    importDocumentsMatch: importDocumentsMatch, buildHistoryImportOptions: historyImportOptions };
}));
