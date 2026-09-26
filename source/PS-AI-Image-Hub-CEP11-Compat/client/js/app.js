(function bootstrap(root) {
  "use strict";
  var hub = root.PSAIImageHubCompat;
  var bootStage = "bootstrap";

  function safeFailure(error) {
    var stack = String(error && error.stack || "").slice(0, 1200);
    var location = stack.match(/([^\s()]+\.js):(\d+):(\d+)/);
    return {
      stage: bootStage,
      name: String(error && error.name || "Error").slice(0, 80),
      message: String(error && error.message || error || "Unknown startup error").slice(0, 500),
      file: location ? location[1] : "",
      line: location ? Number(location[2]) : null,
      column: location ? Number(location[3]) : null,
      stack: stack
    };
  }

  function bootEvent(name, data) {
    root.__PSAIImageHubCompatBootDiagnostics = root.__PSAIImageHubCompatBootDiagnostics || [];
    root.__PSAIImageHubCompatBootDiagnostics.push({ event: name, data: data || null, at: new Date().toISOString() });
    try {
      if (hub && hub.logger && typeof hub.logger.info === "function") hub.logger.info(name, data);
      else if (root.console && typeof root.console.log === "function") root.console.log("[PS AI Image Hub CEP] " + name, data || "");
    } catch (error) { /* Diagnostics must never break startup. */ }
  }

  function optionalModule(stage, factory) {
    try { return factory(); }
    catch (error) { bootEvent(stage + "_DEGRADED", safeFailure(error)); return null; }
  }

  function start() {
    bootStage = "document";
    bootEvent("BOOT_START");
    var appRoot = document.getElementById("app");
    if (!appRoot) throw new Error("PS AI Image Hub CEP root element was not found.");
    bootStage = "config";
    var t = hub.createTranslator("zh-CN");
    var cepCapabilities = hub.detectCepCapabilities(root);
    var hostInfo = hub.readHostEnvironment({ root: root });
    var profile = hub.compatibilityProfile(hostInfo);
    var hostCapabilities = hub.emptyHostCapabilities();
    var fallbacks = ["Network -> XMLHttpRequest compatibility transport"];
    var localStorageCompat = hub.createCompatibleStorage(root.localStorage, function storageFallback() {
      fallbacks.push("Persistent localStorage -> MemoryStore (session only)");
    });
    var sessionStorageCompat = hub.createCompatibleStorage(root.sessionStorage, function sessionFallback() {
      fallbacks.push("sessionStorage -> MemoryStore");
    });
    var compatFileDialog = hub.createFileDialogCompatibility();
    if (!compatFileDialog.available) fallbacks.push("CEP file APIs unavailable; file features disabled");
    var bootCompatibilityReport = hub.createBootCompatibilityReport({
      host: hostInfo,
      profile: profile,
      cepRuntime: hub.detectCepRuntime(root),
      cepCapabilities: cepCapabilities,
      hostCapabilities: hostCapabilities,
      fallbacks: fallbacks,
      unsupportedCapabilities: Object.keys(cepCapabilities).filter(function unsupported(name) {
        return name.indexOf("has") === 0 && cepCapabilities[name] === false;
      })
    });
    root.BOOT_COMPATIBILITY_REPORT = bootCompatibilityReport;
    bootEvent("BOOT_COMPATIBILITY_REPORT", bootCompatibilityReport);
    var registry = new hub.ProviderRegistry();
    var apiClient = new hub.ApiClient({ timeout: 25000, networkTransport: hub.networkTransport });
    var providerStore = new hub.ProviderStore({ storage: localStorageCompat.storage });
    var photoshopBridge = new hub.PhotoshopBridge();
    var persistentSecretStore = new hub.PersistentSecretStore({ photoshopBridge: photoshopBridge, cepFs: compatFileDialog });
    var secretStore = new hub.SecretStore({ namespace: "ps-ai-image-hub.compat.cep11", storage: sessionStorageCompat.storage,
      persistence: persistentSecretStore });
    var savedProviderConfigs = providerStore.load();
    bootEvent("BOOT_CONFIG_READY", { configuredProviderCount: savedProviderConfigs.length });
    bootStage = "secret";
    var secretNames = ["provider:grs:apiKey", "provider:aliyun-bailian:apiKey"]
      .concat(savedProviderConfigs.map(function secretName(config) { return "provider:" + config.id + ":apiKey"; }));
    try { secretStore.hydrate(secretNames); }
    catch (error) { bootEvent("BOOT_SECRET_DEGRADED", safeFailure(error)); }
    bootEvent("BOOT_SECRET_READY");
    bootStage = "provider";
    var grsTaskStore = new hub.GrsTaskStore({ storage: localStorageCompat.storage });
    var asyncTaskStore = optionalModule("BOOT_ASYNC_TASK_STORE", function createAsyncTaskStore() {
      return typeof hub.AsyncTaskStore === "function" ? new hub.AsyncTaskStore({ storage: localStorageCompat.storage }) : null;
    });
    var grsAccountClient = new hub.GrsAccountClient({ apiClient: apiClient });
    registry.register(new hub.MockProvider());
    registry.register(new hub.GrsProvider(null, { apiClient: apiClient, secretStore: secretStore, taskStore: grsTaskStore, accountClient: grsAccountClient }));
    if (typeof hub.AliyunBailianProvider === "function") {
      registry.register(new hub.AliyunBailianProvider(null, { apiClient: apiClient, secretStore: secretStore, asyncTaskStore: asyncTaskStore }));
    } else {
      bootEvent("BOOT_ALIYUN_BAILIAN_DEGRADED", { message: "Aliyun Bailian Provider module is unavailable." });
    }
    var providerFactory = new hub.ProviderFactory({ apiClient: apiClient, secretStore: secretStore, taskStore: grsTaskStore,
      asyncTaskStore: asyncTaskStore, accountClient: grsAccountClient });
    var providerManager = new hub.ProviderManager(registry, {
      providerStore: providerStore,
      secretStore: secretStore,
      providerFactory: providerFactory
    });
    providerManager.loadConfiguredProviders(savedProviderConfigs);
    bootEvent("BOOT_PROVIDER_READY", { providerCount: registry.size });
    bootStage = "model-state";
    var uiStateStore = optionalModule("BOOT_MODEL_STATE", function createModelState() {
      return typeof hub.UiStateStore === "function" ? new hub.UiStateStore({ providerManager: providerManager,
        storage: localStorageCompat.storage }) : null;
    });
    bootEvent("BOOT_MODEL_STATE_READY", { available: Boolean(uiStateStore) });
    bootStage = "recovery";
    var recoveryStore = optionalModule("BOOT_RECOVERY", function createRecovery() {
      return typeof hub.GenerationRecoveryStore === "function" ? new hub.GenerationRecoveryStore({ photoshopBridge: photoshopBridge,
        cepFs: compatFileDialog }) : null;
    });
    bootEvent("BOOT_RECOVERY_READY", { available: Boolean(recoveryStore) });
    bootStage = "import";
    var imageFileStore = new hub.ImageFileStore({ photoshopBridge: photoshopBridge, apiClient: apiClient, cepFs: compatFileDialog });
    var importSizingManager = optionalModule("BOOT_IMPORT_SIZING", function createImportSizing() {
      return typeof hub.ImportSizingManager === "function" ? new hub.ImportSizingManager({ photoshopBridge: photoshopBridge,
        cepFs: compatFileDialog }) : null;
    });
    var imageImporter = new hub.ImageImporter({ photoshopBridge: photoshopBridge, imageFileStore: imageFileStore, importSizingManager: importSizingManager });
    var referenceImageManager = new hub.ReferenceImageManager({ photoshopBridge: photoshopBridge, cepFs: compatFileDialog });
    var historyStore = new hub.HistoryStore({ photoshopBridge: photoshopBridge, apiClient: apiClient, cepFs: compatFileDialog,
      maxHistoryCount: 50 });
    bootStage = "prompt-preset";
    var promptPresetStore = optionalModule("BOOT_PROMPT_PRESET_STORE", function createPromptPresetStore() {
      return typeof hub.PromptPresetStore === "function" ? new hub.PromptPresetStore({ storage: localStorageCompat.storage }) : null;
    });
    var promptPresetRegistry = optionalModule("BOOT_PROMPT_PRESET_REGISTRY", function createPromptPresetRegistry() {
      return promptPresetStore && typeof hub.PromptPresetRegistry === "function"
        ? new hub.PromptPresetRegistry({ store: promptPresetStore }) : null;
    });
    var promptPresetCompiler = optionalModule("BOOT_PROMPT_PRESET_COMPILER", function createPromptPresetCompiler() {
      return typeof hub.PromptPresetCompiler === "function" ? new hub.PromptPresetCompiler() : null;
    });
    var promptPresetStack = optionalModule("BOOT_PROMPT_PRESET_STACK", function createPromptPresetStack() {
      return promptPresetRegistry && typeof hub.PromptPresetStack === "function"
        ? new hub.PromptPresetStack({ registry: promptPresetRegistry, store: promptPresetStore }) : null;
    });
    bootEvent("BOOT_PROMPT_PRESET_READY", {
      available: Boolean(promptPresetRegistry && promptPresetCompiler), stackAvailable: Boolean(promptPresetStack)
    });
    bootStage = "storage";
    var storageManager = optionalModule("BOOT_STORAGE", function createStorage() {
      return typeof hub.StorageManager === "function" ? new hub.StorageManager({ photoshopBridge: photoshopBridge,
        historyStore: historyStore, taskStore: grsTaskStore, cepFs: compatFileDialog }) : null;
    });
    bootEvent("BOOT_STORAGE_READY", { available: Boolean(storageManager) });
    bootStage = "ui";
    var generationManager = new hub.GenerationManager({
      providerManager: providerManager,
      imageImporter: imageImporter,
      historyStore: historyStore,
      recoveryStore: recoveryStore,
      t: t
    });
    var panel = new hub.MainPanel({
      root: appRoot,
      providerManager: providerManager,
      generationManager: generationManager,
      photoshopBridge: photoshopBridge,
      referenceImageManager: referenceImageManager,
      historyStore: historyStore,
      uiStateStore: uiStateStore,
      recoveryStore: recoveryStore,
      storageManager: storageManager,
      promptPresetRegistry: promptPresetRegistry,
      promptPresetCompiler: promptPresetCompiler,
      promptPresetStack: promptPresetStack,
      compatFileDialog: compatFileDialog,
      cepCapabilities: cepCapabilities,
      hostCapabilities: hostCapabilities,
      storagePersistent: localStorageCompat.persistent,
      t: t
    });
    panel.mount();
    bootEvent("BOOT_UI_READY");
    hub.getHostCapabilities(photoshopBridge).then(function hostCapabilitiesReady(detected) {
      hostCapabilities = detected;
      panel.setHostCapabilities(detected);
      bootCompatibilityReport.hostCapabilities = detected;
      bootCompatibilityReport.unsupportedCapabilities = bootCompatibilityReport.unsupportedCapabilities.concat(
        Object.keys(detected).filter(function unsupportedHost(name) { return detected[name] === false; })
      );
      root.BOOT_COMPATIBILITY_REPORT = hub.redactDiagnostics(bootCompatibilityReport, 0);
      bootEvent("BOOT_HOST_CAPABILITIES_READY", root.BOOT_COMPATIBILITY_REPORT);
    });
    hub.logger.info("CEP11 Compat panel initialized", { providerCount: registry.size, nodeEnabled: false,
      profile: profile, persistentStorage: localStorageCompat.persistent });
  }

  try { start(); }
  catch (error) {
    var failure = safeFailure(error);
    try { if (hub && hub.logger) hub.logger.error("BOOT_FAILED", failure); else if (root.console) root.console.error("BOOT_FAILED", failure); } catch (loggingError) {}
    var appRoot = document.getElementById("app");
    if (appRoot) appRoot.textContent = "插件初始化失败（" + failure.stage + "）：" + failure.message +
      (failure.file ? " · " + failure.file + ":" + failure.line : "");
  }
}(typeof globalThis !== "undefined" ? globalThis : this));
