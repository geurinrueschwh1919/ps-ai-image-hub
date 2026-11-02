"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PersistentPanelController, CEP_PERSISTENT_EVENT, CEP_PERSISTENT_SCOPE,
  createPersistentEventInterface } = require("../client/js/compat/persistentPanel");
const { SettingsPanel } = require("../client/js/ui/settingsPanel");
const { HistoryPanel, HISTORY_PAGE_SIZE } = require("../client/js/ui/historyPanel");

const runtime = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(runtime, relative), "utf8");

function cepRuntime(options = {}) {
  const events = [];
  function Event(type, scope) { this.type = type; this.scope = scope; this.data = ""; }
  function Interface() {}
  Interface.prototype.getExtensionID = function getExtensionID() {
    if (options.idError) throw options.idError;
    return options.extensionId || "dynamic.test.extension";
  };
  Interface.prototype.dispatchEvent = function dispatchEvent(event) {
    if (options.dispatchError) throw options.dispatchError;
    events.push(event); return true;
  };
  return { CSInterface: Interface, CSEvent: Event, events };
}

function reloadPanel(options = {}) {
  const fields = { "reload-plugin-ui": { disabled: false }, "storage-message": { textContent: "" } };
  const panel = Object.create(SettingsPanel.prototype);
  panel.storageMutationBusy = Boolean(options.storageMutationBusy);
  panel.isReloadBlocked = options.isReloadBlocked || (() => false);
  panel.runtime = options.runtime || { confirm() { return true; }, location: { reload() {} } };
  panel.t = (key) => key;
  panel.field = (id) => fields[id] || null;
  return { panel, fields };
}

test("persistent 1 uses the official Photoshop persistent event name", () => {
  assert.equal(CEP_PERSISTENT_EVENT, "com.adobe.PhotoshopPersistent");
});

test("persistent 2 uses APPLICATION scope", () => {
  assert.equal(CEP_PERSISTENT_SCOPE, "APPLICATION");
});

test("persistent 3 targets the runtime extension ID", () => {
  const target = cepRuntime({ extensionId: "runtime.supplied.id" });
  const result = new PersistentPanelController({ root: target }).request();
  assert.equal(result.requested, true);
  assert.equal(target.events[0].extensionId, "runtime.supplied.id");
});

test("persistent 4 does not hardcode the lab Extension ID as the event target", () => {
  assert.doesNotMatch(read("client/js/compat/persistentPanel.js"), /com\.psai\.imagehub\.compat\.cep11\.panel/);
});

test("persistent 4b does not hardcode the Formal Extension ID as the event target", () => {
  assert.doesNotMatch(read("client/js/compat/persistentPanel.js"), /com\.psaiimagehub\.cep\.panel/);
});

test("persistent 5 dispatches at most once per page controller", () => {
  const target = cepRuntime(), controller = new PersistentPanelController({ root: target });
  controller.request(); controller.request(); controller.request();
  assert.equal(target.events.length, 1);
});

test("persistent 6 reports repeated initialization as a duplicate no-op", () => {
  const controller = new PersistentPanelController({ root: cepRuntime() });
  controller.request();
  assert.deepEqual(controller.request(), { requested: false, duplicate: true,
    eventType: "com.adobe.PhotoshopPersistent", scope: "APPLICATION" });
});

test("persistent 7 a new HTML page controller may dispatch once again", () => {
  const target = cepRuntime();
  new PersistentPanelController({ root: target }).request();
  new PersistentPanelController({ root: target }).request();
  assert.equal(target.events.length, 2);
});

test("persistent 8 missing CEP APIs degrade without throwing", () => {
  assert.doesNotThrow(() => new PersistentPanelController({ root: {} }).request());
  assert.equal(new PersistentPanelController({ root: {} }).request().failed, true);
});

test("persistent 9 getExtensionID failures do not block bootstrap", () => {
  const result = new PersistentPanelController({ root: cepRuntime({ idError: new Error("unavailable") }) }).request();
  assert.equal(result.failed, true);
});

test("persistent 10 dispatch failures do not block bootstrap", () => {
  const result = new PersistentPanelController({ root: cepRuntime({ dispatchError: new Error("unavailable") }) }).request();
  assert.equal(result.failed, true);
});

test("persistent 11 diagnostics redact exception message content", () => {
  const logs = [];
  new PersistentPanelController({ root: cepRuntime({ idError: new Error("API_KEY=/secret/path prompt body") }),
    logger: { warn(name, data) { logs.push({ name, data }); } } }).request();
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /secret|prompt body/i);
});

test("persistent 12 no UnPersistent event is dispatched", () => {
  const source = read("client/js/compat/persistentPanel.js") + read("client/js/app.js");
  assert.doesNotMatch(source, /PhotoshopUnPersistent/);
});

test("persistent 13 no unload handler cancels persistence", () => {
  const source = read("client/js/compat/persistentPanel.js") + read("client/js/app.js");
  assert.doesNotMatch(source, /beforeunload|unload\s*[,)]/);
});

test("persistent 14 the project CSInterface foundation remains at its minimal baseline", () => {
  const source = read("client/lib/CSInterface.js");
  assert.doesNotMatch(source, /function CSEvent\(/);
  assert.doesNotMatch(source, /prototype\.getExtensionID/);
  assert.doesNotMatch(source, /prototype\.dispatchEvent/);
});

test("persistent 14b local fallback uses native CEP getExtensionId and dispatchEvent", () => {
  const events = [];
  function MinimalInterface() {}
  const runtime = { CSInterface: MinimalInterface, __adobe_cep__: {
    getExtensionId() { return "native.dynamic.id"; }, dispatchEvent(event) { events.push(event); }
  } };
  const facade = createPersistentEventInterface(runtime);
  assert.equal(facade.getExtensionID(), "native.dynamic.id");
  assert.equal(facade.dispatchEvent({ type: "sample", data: "" }), true);
  assert.equal(events.length, 1);
});

test("persistent 14c the minimal foundation still supports Persistent through the local module", () => {
  const events = [];
  function MinimalInterface() {}
  const runtime = { CSInterface: MinimalInterface, __adobe_cep__: {
    getExtensionId() { return "native.dynamic.id"; }, dispatchEvent(event) { events.push(event); }
  } };
  assert.equal(new PersistentPanelController({ root: runtime }).request().requested, true);
  assert.deepEqual({ type: events[0].type, scope: events[0].scope, extensionId: events[0].extensionId },
    { type: "com.adobe.PhotoshopPersistent", scope: "APPLICATION", extensionId: "native.dynamic.id" });
});

test("persistent 15 the lifecycle module loads before app bootstrap", () => {
  const html = read("client/index.html");
  assert.ok(html.indexOf("js/compat/persistentPanel.js") > html.indexOf("lib/CSInterface.js"));
  assert.ok(html.indexOf("js/compat/persistentPanel.js") < html.indexOf("js/app.js"));
});

test("persistent 16 app requests persistence before configuration initialization", () => {
  const app = read("client/js/app.js");
  assert.ok(app.indexOf("requestPersistentPanel") < app.indexOf('bootStage = "config"'));
});

test("persistent 17 app bootstrap itself has a same-page duplicate guard", () => {
  assert.match(read("client/js/app.js"), /__PSAIImageHubCompatBootstrapStarted/);
});

test("reload 18 Settings contains the Reload Plugin UI action", () => {
  assert.match(read("client/js/ui/settingsPanel.js"), /id="reload-plugin-ui"/);
});

test("reload 19 Chinese confirmation copy is complete", () => {
  assert.match(read("client/js/i18n/zh-CN.js"), /重新加载会清空当前尚未提交的提示词、参考图片和临时界面状态，但不会删除API Key、历史记录、Prompt Preset或设置。是否继续？/);
});

test("reload 20 English confirmation copy is complete", () => {
  assert.match(read("client/js/i18n/en-US.js"), /Reloading will clear the current unsent prompt, reference images, and temporary UI state\. API keys, history, prompt presets, and settings will not be deleted\. Continue\?/);
});

test("reload 21 cancel leaves the page untouched", () => {
  let reloads = 0;
  const { panel } = reloadPanel({ runtime: { confirm() { return false; }, location: { reload() { reloads += 1; } } } });
  assert.equal(panel.reloadPluginUi(), false); assert.equal(reloads, 0);
});

test("reload 22 confirmation reloads the current HTML page exactly once", () => {
  let reloads = 0;
  const { panel } = reloadPanel({ runtime: { confirm() { return true; }, location: { reload() { reloads += 1; } } } });
  assert.equal(panel.reloadPluginUi(), true); assert.equal(reloads, 1);
});

test("reload 23 reload action contains no persistence deletion calls", () => {
  const source = read("client/js/ui/settingsPanel.js");
  const method = source.slice(source.indexOf("\n    reloadPluginUi() {"), source.indexOf("async copyStoragePath"));
  assert.doesNotMatch(method, /clear|removeItem|delete|storageManager\./);
});

test("reload 23b never clears History", () => {
  const source = read("client/js/ui/settingsPanel.js");
  const method = source.slice(source.indexOf("\n    reloadPluginUi() {"), source.indexOf("async copyStoragePath"));
  assert.doesNotMatch(method, /historyStore|clearHistory|historyImages/);
});

test("reload 23c never clears API keys", () => {
  const source = read("client/js/ui/settingsPanel.js");
  const method = source.slice(source.indexOf("\n    reloadPluginUi() {"), source.indexOf("async copyStoragePath"));
  assert.doesNotMatch(method, /secretStore|clearCurrentKey|apiKey/);
});

test("reload 23d never clears Prompt Presets", () => {
  const source = read("client/js/ui/settingsPanel.js");
  const method = source.slice(source.indexOf("\n    reloadPluginUi() {"), source.indexOf("async copyStoragePath"));
  assert.doesNotMatch(method, /promptPreset|presetStore|factoryRestore/);
});

test("reload 23e never clears saved settings", () => {
  const source = read("client/js/ui/settingsPanel.js");
  const method = source.slice(source.indexOf("\n    reloadPluginUi() {"), source.indexOf("async copyStoragePath"));
  assert.doesNotMatch(method, /providerStore|uiStateStore|removeItem|clearStorage/);
});

test("reload 24 busy state disables the button", () => {
  const { panel, fields } = reloadPanel({ isReloadBlocked: () => true });
  assert.equal(panel.syncReloadButton(), false); assert.equal(fields["reload-plugin-ui"].disabled, true);
});

test("reload 25 direct invocation while busy is refused with a message", () => {
  let confirmed = false;
  const { panel, fields } = reloadPanel({ isReloadBlocked: () => true,
    runtime: { confirm() { confirmed = true; return true; }, location: { reload() { throw new Error("must not reload"); } } } });
  assert.equal(panel.reloadPluginUi(), false); assert.equal(confirmed, false);
  assert.equal(fields["storage-message"].textContent, "reloadPluginBusy");
});

test("reload 26 button is restored when the protected activity ends", () => {
  let busy = true; const { panel, fields } = reloadPanel({ isReloadBlocked: () => busy });
  panel.syncReloadButton(); busy = false;
  assert.equal(panel.syncReloadButton(), true); assert.equal(fields["reload-plugin-ui"].disabled, false);
});

test("reload 27 storage mutations are independently protected", () => {
  const { panel } = reloadPanel({ storageMutationBusy: true });
  assert.equal(panel.reloadIsBlocked(), true);
});

test("reload 28 generation import recovery and History activity feed the central guard", () => {
  const source = read("client/js/ui/mainPanel.js");
  assert.match(source, /isReloadBlocked\(\)[\s\S]*this\.isGenerating[\s\S]*this\.isImporting[\s\S]*this\.busyOperationCount[\s\S]*historyPanel\.isBusy/);
});

test("reload 29 manual Auto Sharpen marks the panel busy until completion", () => {
  const source = read("client/js/ui/mainPanel.js");
  const method = source.slice(source.indexOf("async handleManualSharpen"), source.indexOf("async reimportHistoryEntry"));
  assert.match(method, /this\.isImporting = true/); assert.match(method, /finally[\s\S]*this\.isImporting = false/);
});

test("reload 30 History delete mutations publish busy transitions", () => {
  const states = [];
  const panel = Object.create(HistoryPanel.prototype);
  panel.busy = false; panel.onBusyChange = (value) => states.push(value);
  assert.equal(panel.runMutation(() => {}), true);
  assert.deepEqual(states, [true, false]);
});

test("lifecycle 31 all three UI roots reject duplicate mount calls", () => {
  assert.match(read("client/js/ui/mainPanel.js"), /mount\(\) \{\s*if \(this\.mounted\) return;/);
  assert.match(read("client/js/ui/settingsPanel.js"), /mount\(\) \{\s*if \(this\.mounted\) return;/);
  assert.match(read("client/js/ui/historyPanel.js"), /mount\(\) \{\s*if \(this\.mounted\) return;/);
});

test("lifecycle 32 storage event wiring also has its own duplicate guard", () => {
  assert.match(read("client/js/ui/settingsPanel.js"), /if \(this\.storageManagerMounted\) \{ this\.syncReloadButton\(\); return; \}/);
});

test("lifecycle 33 History pagination remains twenty records per page", () => {
  assert.equal(HISTORY_PAGE_SIZE, 20);
});

test("lifecycle 34 History thumbnails remain browser-lazy", () => {
  assert.match(read("client/js/ui/historyPanel.js"), /image\.loading = "lazy"/);
});

test("lifecycle 35 the reload control is caution-styled, not destructive", () => {
  const settings = read("client/js/ui/settingsPanel.js");
  assert.match(settings, /id="reload-plugin-ui" class="reload-plugin-button"/);
  assert.doesNotMatch(settings, /id="reload-plugin-ui" class="danger-button"/);
});

test("lifecycle 36 experiment identity and storage namespace remain isolated", () => {
  const manifest = read("CSXS/manifest.xml"), app = read("client/js/app.js");
  assert.match(manifest, /com\.psai\.imagehub\.compat\.cep11\.panel/);
  assert.match(app, /ps-ai-image-hub\.compat\.cep11/);
  assert.doesNotMatch(app, /namespace:\s*"ps-ai-image-hub\.cep11"/);
});

test("lifecycle 37 documentation states process lifetime and reload semantics", () => {
  const docs = fs.readFileSync(path.resolve(runtime, "..", "..", "V1.1.0-INTEGRATION.md"), "utf8");
  assert.match(docs, /same Photoshop process remains alive/);
  assert.match(docs, /full Photoshop exit, crash, process restart, or explicit \*\*Reload Plugin/);
});

test("lifecycle 38 actual Photoshop persistence remains a manual host test", () => {
  const source = read("client/js/compat/persistentPanel.js");
  assert.doesNotMatch(source, /setInterval|setTimeout|fakePersistent|simulatePersistent/i);
});
