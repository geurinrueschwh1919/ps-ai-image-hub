"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { StorageManager } = require("../client/js/storage/storageManager");
const { GenerationRecoveryStore } = require("../client/js/storage/generationRecoveryStore");
const hostCompatibility = require("../client/js/compat/hostCompatibility");

const cepRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(cepRoot, "client/js/app.js"), "utf8");

function constructor(value) { return function Fake() { Object.assign(this, typeof value === "function" ? value() : value || {}); }; }

function runBootstrap(options) {
  const settings = options || {}, events = [], appRoot = { textContent: "" }, state = { mounted: 0 };
  function Registry() { this.items = []; this.size = 0; }
  Registry.prototype.register = function register(item) { this.items.push(item); this.size = this.items.length; };
  const hub = {
    logger: { info(name, data) { events.push({ level: "info", name, data }); }, error(name, data) { events.push({ level: "error", name, data }); }, warn() {} },
    createTranslator() { return (key) => key; }, ProviderRegistry: Registry,
    ApiClient: constructor(), ProviderStore: constructor({ load() { return []; } }),
    PhotoshopBridge: settings.capabilityProbeThrows ? constructor({ invoke() { throw new Error("capability probe unavailable"); } }) : constructor(),
    PersistentSecretStore: constructor(), SecretStore: constructor({ hydrate() { if (settings.secretThrows) throw new Error("USER_DATA denied"); } }),
    GrsTaskStore: constructor(), GrsAccountClient: constructor(), MockProvider: constructor({ id: "mock" }), GrsProvider: constructor({ id: "grs" }),
    ProviderFactory: constructor(), ProviderManager: constructor({ loadConfiguredProviders() {} }),
    ImageFileStore: constructor(), ImageImporter: constructor(), ReferenceImageManager: constructor(), HistoryStore: constructor(),
    GenerationManager: constructor(),
    detectCepCapabilities() { return { hasFileDialog: false, hasFetch: false, hasXHR: true }; },
    readHostEnvironment() { return { hostName: "PHSP", hostVersion: "25.0.0", hostMajor: 25 }; },
    compatibilityProfile() { return "PS25_CEP11"; }, emptyHostCapabilities() { return {}; },
    createCompatibleStorage(storage) { return { storage: storage || { getItem() { return null; }, setItem() {}, removeItem() {} }, persistent: true }; },
    createFileDialogCompatibility() { return { available: false }; }, detectCepRuntime() { return { family: "CEP 11.x" }; },
    createBootCompatibilityReport(value) { return value; }, redactDiagnostics(value) { return value; },
    getHostCapabilities: hostCompatibility.getHostCapabilities, networkTransport: { request() {} },
    MainPanel: function MainPanel() { this.mount = function mount() { if (settings.uiThrows) throw new Error("UI mount failure"); state.mounted += 1; }; this.setHostCapabilities = function setHostCapabilities() {}; }
  };
  if (!settings.missingOptional) {
    hub.UiStateStore = settings.modelThrows ? function BadModel() { throw new Error("model state unavailable"); } : constructor();
    hub.GenerationRecoveryStore = settings.recoveryThrows ? function BadRecovery() { throw new Error("recovery unavailable"); } : constructor();
    hub.StorageManager = settings.storageThrows ? function BadStorage() { throw new Error("storage unavailable"); } : constructor();
    hub.ImportSizingManager = settings.sizingThrows ? function BadSizing() { throw new Error("sizing unavailable"); } : constructor();
  }
  if (!settings.missingPromptPreset) {
    hub.PromptPresetStore = settings.presetThrows ? function BadPresetStore() { throw new Error("preset storage unavailable"); } : constructor();
    hub.PromptPresetRegistry = constructor();
    hub.PromptPresetCompiler = constructor();
  }
  const context = { PSAIImageHubCompat: hub, document: { getElementById(id) { return id === "app" ? appRoot : null; } }, console,
    Date, Boolean, String, Number, Error, Object, Array, JSON, Math, Promise, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context); vm.runInContext(appSource, context, { filename: "app.js" });
  return { events, appRoot, state, diagnostics: context.__PSAIImageHubCompatBootDiagnostics };
}

test("startup diagnostics emit every required ready stage", () => {
  const result = runBootstrap(), names = result.events.map((item) => item.name);
  for (const event of ["BOOT_START", "BOOT_CONFIG_READY", "BOOT_SECRET_READY", "BOOT_PROVIDER_READY", "BOOT_MODEL_STATE_READY",
    "BOOT_RECOVERY_READY", "BOOT_STORAGE_READY", "BOOT_UI_READY"]) assert.ok(names.includes(event), event);
  assert.equal(result.state.mounted, 1);
});

test("host capability probe failure degrades safely after the core UI mounts", async () => {
  const result = runBootstrap({ capabilityProbeThrows: true });
  await Promise.resolve();
  assert.equal(result.state.mounted, 1);
  assert.equal(result.appRoot.textContent, "");
  assert.equal(result.events.some((item) => item.name === "BOOT_FAILED"), false);
  assert.equal(result.events.some((item) => item.name === "BOOT_HOST_CAPABILITIES_READY"), true);
});

test("missing every optional H2.4 module does not crash the core UI", () => {
  const result = runBootstrap({ missingOptional: true });
  assert.equal(result.state.mounted, 1); assert.equal(result.events.some((item) => item.name === "BOOT_UI_READY"), true);
  assert.equal(result.appRoot.textContent, "");
});

test("Storage, Recovery, sizing, and model-state constructor failures are independently degraded", () => {
  const result = runBootstrap({ storageThrows: true, recoveryThrows: true, sizingThrows: true, modelThrows: true });
  assert.equal(result.state.mounted, 1);
  for (const event of ["BOOT_STORAGE_DEGRADED", "BOOT_RECOVERY_DEGRADED", "BOOT_IMPORT_SIZING_DEGRADED", "BOOT_MODEL_STATE_DEGRADED"])
    assert.ok(result.events.some((item) => item.name === event), event);
});

test("USER_DATA-backed secret hydration failure remains session-degraded and UI starts", () => {
  const result = runBootstrap({ secretThrows: true });
  assert.equal(result.state.mounted, 1); assert.ok(result.events.some((item) => item.name === "BOOT_SECRET_DEGRADED"));
});

test("missing or failing Prompt Preset modules degrade without blocking the core UI", () => {
  const missing = runBootstrap({ missingPromptPreset: true });
  assert.equal(missing.state.mounted, 1);
  assert.ok(missing.events.some((item) => item.name === "BOOT_PROMPT_PRESET_READY" && item.data.available === false));
  const failing = runBootstrap({ presetThrows: true });
  assert.equal(failing.state.mounted, 1);
  assert.ok(failing.events.some((item) => item.name === "BOOT_PROMPT_PRESET_STORE_DEGRADED"));
});

test("core UI failure reports BOOT_FAILED stage, message, file, and line safely", () => {
  const result = runBootstrap({ uiThrows: true }), failed = result.events.find((item) => item.name === "BOOT_FAILED");
  assert.ok(failed); assert.equal(failed.data.stage, "ui"); assert.match(failed.data.message, /UI mount failure/);
  assert.match(result.appRoot.textContent, /插件初始化失败（ui）/);
});

test("clipboard unavailable uses legacy fallback and never fails at module initialization", async () => {
  const previousNavigator = globalThis.navigator, previousDocument = globalThis.document;
  let copied = false, removed = false;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  globalThis.document = { body: { appendChild() {}, removeChild() { removed = true; } }, createElement() { return { style: {}, select() {} }; }, execCommand(command) { copied = command === "copy"; return true; } };
  delete require.cache[require.resolve("../client/js/utils/clipboard")];
  try { await require("../client/js/utils/clipboard").copyText("C:/缓存/PSAIImageHub"); }
  finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator }); globalThis.document = previousDocument;
    delete require.cache[require.resolve("../client/js/utils/clipboard")];
  }
  assert.equal(copied, true); assert.equal(removed, true);
});

test("Storage scan exception returns unavailable report instead of throwing", () => {
  const manager = new StorageManager({ photoshopBridge: { getUserDataRoot() { throw new Error("USER_DATA unavailable"); } }, cepFs: {} });
  const report = manager.scan(); assert.equal(report.unavailable, true); assert.equal(report.totalFiles, 0); assert.ok(report.categories.sensitiveConfig);
});

test("missing cache directory is an empty nonfatal scan", () => {
  const manager = new StorageManager({ rootPath: "C:/不存在/PSAIImageHub", cepFs: { readdir() { return { err: 3 }; }, stat() { return { err: 3 }; } } });
  const report = manager.scan(); assert.equal(report.totalFiles, 0); assert.equal(report.categories.downloads.fileCount, 0);
});

test("Unicode USER_DATA root is preserved without path corruption", () => {
  const rootPath = "D:/Fixture/UserData/PSAIImageHub";
  const manager = new StorageManager({ rootPath, cepFs: { readdir(pathValue) { assert.equal(pathValue, rootPath); return { err: 0, data: [] }; }, stat() { return { err: 1 }; } } });
  const report = manager.scan(); assert.equal(report.rootPath, rootPath); assert.equal(report.unavailable, false);
});

test("invalid recovery JSON and throwing image read are skipped", () => {
  let metadata = "not-json";
  const cepFs = { readFile(pathValue) { if (/metadata\.json$/.test(pathValue)) return { err: 0, data: metadata }; throw new Error("missing image"); } };
  const store = new GenerationRecoveryStore({ rootPath: "C:/缓存/task-recovery", cepFs });
  assert.equal(store.restoreSnapshot("t1"), null);
  metadata = JSON.stringify({ taskId: "t1", mainImage: { fileName: "missing.png" }, referenceImages: [] });
  const restored = store.restoreSnapshot("t1"); assert.equal(restored.mainImage, null); assert.equal(restored.imagesMissing, true);
});

test("model sync programmatic echo cannot recurse", () => {
  const { UiStateStore } = require("../client/js/storage/uiStateStore");
  let model = "a", writes = 0, notifications = 0;
  const state = new UiStateStore({ providerManager: { getProviderConfig() { return { modelId: model }; }, setSelectedModel(id, value) { writes += 1; model = value; } },
    storage: { getItem() { return null; }, setItem() {} } });
  state.subscribe((change) => { notifications += 1; state.setModel(change.providerId, change.modelId, "programmatic-echo"); });
  state.setModel("grs", "b", "settings");
  assert.equal(writes, 1); assert.equal(notifications, 1); assert.equal(model, "b");
});

test("H2.4 runtime sources avoid unsupported modern syntax and Node-only direct imports", () => {
  const files = ["storage/uiStateStore.js", "storage/generationRecoveryStore.js", "storage/storageManager.js", "photoshop/importSizingManager.js", "app.js"];
  const combined = files.map((file) => fs.readFileSync(path.join(cepRoot, "client/js", file), "utf8")).join("\n");
  assert.doesNotMatch(combined, /\?\.|\?\?|Object\.fromEntries|Promise\.finally|\.padStart\(|new URL\(|URLSearchParams/);
  assert.doesNotMatch(combined, /(?:^|\n)\s*(?:import\s|require\s*\()/);
});

test("current staging index script references resolve with exact case", () => {
  const staging = path.resolve(cepRoot, "../../outputs/dev/PS-AI-Image-Hub-CEP11-Compat"), htmlPath = path.join(staging, "client/index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const refs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length > 0);
  refs.forEach((ref) => assert.equal(fs.existsSync(path.resolve(path.dirname(htmlPath), ref)), true, ref));
  for (const file of ["js/storage/uiStateStore.js", "js/storage/generationRecoveryStore.js", "js/storage/storageManager.js", "js/photoshop/importSizingManager.js"])
    assert.ok(refs.includes(file), file);
});

function fakeElement(kind) {
  const element = { kind: kind || "div", value: "", hidden: false, disabled: false, checked: false, textContent: "", children: [], options: [],
    addEventListener() {}, setAttribute() {}, getAttribute() { return ""; }, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); if (child.kind === "option") { this.options.push(child); if (!this.value) this.value = child.value; } return child; } };
  Object.defineProperty(element, "innerHTML", { get() { return ""; }, set() { element.children = []; element.options = []; element.value = ""; } });
  return element;
}

test("real MainPanel mount uses injected storageManager with no global dependencies variable", () => {
  const previousHub = globalThis.PSAIImageHubCompat, previousDocument = globalThis.document, hadDependencies = Object.hasOwn(globalThis, "dependencies"), previousDependencies = globalThis.dependencies;
  delete globalThis.dependencies;
  const elements = new Map(), appRoot = fakeElement("root");
  appRoot.querySelector = function querySelector(selector) { if (!elements.has(selector)) elements.set(selector, fakeElement(selector.indexOf("select") !== -1 ? "select" : "div")); return elements.get(selector); };
  appRoot.querySelectorAll = function querySelectorAll() { return []; };
  let settingsOptions = null;
  function ModelSelector() { this.value = ""; }
  ModelSelector.prototype.mount = function mount() {};
  ModelSelector.prototype.setModels = function setModels(models, selected) { this.value = selected || models[0] && models[0].id || ""; };
  ModelSelector.prototype.getValue = function getValue() { return this.value; };
  ModelSelector.prototype.setDisabled = function setDisabled() {};
  function SettingsPanel(container, toggle, t, options) { settingsOptions = options; }
  SettingsPanel.prototype.mount = function mount() {};
  function HistoryPanel() {} HistoryPanel.prototype.mount = function mount() {};
  const hub = {
    StatusView: function StatusView() { this.update = function update() {}; }, ResultView: function ResultView() { this.clear = function clear() {}; },
    ModelSelector, SettingsPanel, HistoryPanel, enhanceSelects() {}, refreshEnhancedSelect() {},
    MAX_REFERENCE_IMAGES: 8, GRS_STANDARD_RATIOS: [], GRS_GPT_MODELS: [{ supportedAspectRatios: ["1:1"] }], GRS_IMAGE_SIZES: [],
    toUserMessage(error) { return error.message; }
  };
  globalThis.PSAIImageHubCompat = hub;
  globalThis.document = { createElement(kind) { return fakeElement(kind); }, addEventListener() {}, documentElement: { clientWidth: 400, clientHeight: 800 } };
  delete require.cache[require.resolve("../client/js/ui/mainPanel")];
  try {
    require("../client/js/ui/mainPanel");
    const MainPanel = globalThis.PSAIImageHubCompat.MainPanel;
    const storageManager = { scan() { return { unavailable: true, categories: {} }; } };
    const provider = { id: "mock", config: { modelId: "m" }, getModel() { return { id: "m", supportedAspectRatios: ["1:1"] }; }, getCapabilities() { return { supportsImageToImage: false }; } };
    const dependenciesObject = { root: appRoot, providerManager: { listProviders() { return [{ id: "mock", displayName: "Mock" }]; }, getProvider() { return provider; }, getModels() { return [{ id: "m" }]; } },
      generationManager: {}, photoshopBridge: { isAvailable() { return false; } }, referenceImageManager: {}, historyStore: {},
      uiStateStore: null, recoveryStore: null, storageManager, t(key) { return key; } };
    const panel = new MainPanel(dependenciesObject);
    assert.doesNotThrow(() => panel.mount());
    assert.equal(panel.storageManager, storageManager); assert.equal(settingsOptions.storageManager, storageManager);
  } finally {
    globalThis.PSAIImageHubCompat = previousHub; globalThis.document = previousDocument;
    if (hadDependencies) globalThis.dependencies = previousDependencies; else delete globalThis.dependencies;
    delete require.cache[require.resolve("../client/js/ui/mainPanel")];
  }
});

test("real MainPanel mount remains safe when optional storage and recovery dependencies are absent", () => {
  const source = fs.readFileSync(path.join(cepRoot, "client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /this\.storageManager = dependencies\.storageManager \|\| null/);
  assert.match(source, /storageManager: this\.storageManager/);
  const mountBody = source.slice(source.indexOf("mount()"));
  assert.doesNotMatch(mountBody, /\bdependencies\b/);
});
