"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  AutoSharpenManager,
  AutoSharpenPreferenceStore,
  AUTO_SHARPEN_STORAGE_KEY,
  AUTO_SHARPEN_MODES,
  buildAutoSharpenUiState,
  buildAutoSharpenPlan,
  calculateAutoSharpenRadius,
  calculateAutoSharpenEdgeProtection
} = require("../client/js/photoshop/autoSharpenManager");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const zhCN = require("../client/js/i18n/zh-CN");
const enUS = require("../client/js/i18n/en-US");

const runtime = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(runtime, relative), "utf8");
function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test("1 final mode set contains all six modes", () => assert.deepEqual(Object.keys(AUTO_SHARPEN_MODES), ["off", "micro", "natural", "standard", "strong", "custom"]));
test("2 first install defaults to off", () => assert.equal(new AutoSharpenPreferenceStore({ storage: memoryStorage() }).getMode(), "off"));
test("3 micro defaults to 0.5 px", () => assert.equal(buildAutoSharpenPlan("micro", { width: 4000, height: 3000 }, false).radius, 0.5));
test("4 micro accepts 0.4 px", () => assert.equal(buildAutoSharpenPlan("micro", {}, false, { microRadius: 0.4 }).radius, 0.4));
test("5 micro accepts 0.6 px", () => assert.equal(buildAutoSharpenPlan("micro", {}, false, { microRadius: 0.6 }).radius, 0.6));
test("6 micro radius clamps to 0.1 px", () => assert.equal(buildAutoSharpenPlan("micro", {}, false, { microRadius: -5 }).radius, 0.1));
test("7 micro radius clamps to 3.0 px", () => assert.equal(buildAutoSharpenPlan("micro", {}, false, { microRadius: 9 }).radius, 3));
test("8 micro is Linear Light at 100 percent", () => { const plan = buildAutoSharpenPlan("micro", {}, false); assert.equal(plan.blendMode, "linearLight"); assert.equal(plan.opacity, 100); });
test("9 micro does not desaturate by default", () => assert.equal(buildAutoSharpenPlan("micro", {}, false).suppressColorFringing, false));
test("10 color-fringing suppression is explicit in the plan", () => assert.equal(buildAutoSharpenPlan("micro", {}, false, { suppressColorFringing: true }).suppressColorFringing, true));
test("11 host desaturates only the sharpen copy when enabled", () => { const host = read("host/host.jsx"); assert.match(host, /if \(shouldDesaturate\)[\s\S]*sharpenLayer\.desaturate\(\)/); assert.doesNotMatch(host, /originalLayer\.desaturate\(/); });
test("12 original PNG is never rewritten", () => { const source = read("host/host.jsx"); const host = source.slice(source.indexOf("api.applyAutoSharpen"), source.indexOf("api._nextGeneratedLayerNameFromNames")); assert.doesNotMatch(host, /saveAs|PNGSaveOptions|File\(/); });
test("13 History continues to reference the original result", () => { const source = read("client/js/storage/historyStore.js"); assert.match(source, /localResultFile/); assert.doesNotMatch(source, /autoSharpen|清晰化/); });
test("14 natural remains Overlay at 30 percent with auto radius", () => { const plan = buildAutoSharpenPlan("natural", { width: 1400, height: 1400 }, false); assert.equal(plan.blendMode, "overlay"); assert.equal(plan.opacity, 30); assert.equal(plan.radius, 1); });
test("15 standard remains Linear Light at 18 percent", () => { const plan = buildAutoSharpenPlan("standard", { width: 1400, height: 1400 }, false); assert.equal(plan.blendMode, "linearLight"); assert.equal(plan.opacity, 18); assert.equal(plan.radius, 1); });
test("16 strong remains Linear Light at 28 percent", () => { const plan = buildAutoSharpenPlan("strong", { width: 1400, height: 1400 }, false); assert.equal(plan.blendMode, "linearLight"); assert.equal(plan.opacity, 28); assert.equal(plan.radius, 1); });
test("17 custom supports Soft Light", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customBlendMode: "softLight" }).blendMode, "softLight"));
test("18 custom supports Overlay", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customBlendMode: "overlay" }).blendMode, "overlay"));
test("19 custom supports Linear Light", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customBlendMode: "linearLight" }).blendMode, "linearLight"));
test("20 custom supports zero opacity", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customOpacity: 0 }).opacity, 0));
test("21 custom supports 100 percent opacity", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customOpacity: 100 }).opacity, 100));
test("22 custom manual radius supports 0.1 px", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customRadiusMode: "manual", customManualRadius: 0.1 }).radius, 0.1));
test("23 custom manual radius supports 10.0 px", () => assert.equal(buildAutoSharpenPlan("custom", {}, false, { customRadiusMode: "manual", customManualRadius: 10 }).radius, 10));
test("24 custom auto radius keeps the short-edge formula", () => assert.equal(buildAutoSharpenPlan("custom", { width: 2100, height: 1400 }, false, { customRadiusMode: "auto" }).radius, 1));
test("25 preferences persist every custom control in the lab key", () => {
  const storage = memoryStorage();
  const store = new AutoSharpenPreferenceStore({ storage });
  store.setPreferences({ mode: "custom", microRadius: 0.6, customBlendMode: "softLight", customOpacity: 77, customRadiusMode: "manual", customManualRadius: 4.2, suppressColorFringing: true });
  assert.deepEqual(new AutoSharpenPreferenceStore({ storage }).getPreferences(), { mode: "custom", microRadius: 0.6, customBlendMode: "softLight", customOpacity: 77, customRadiusMode: "manual", customManualRadius: 4.2, suppressColorFringing: true });
  assert.match(AUTO_SHARPEN_STORAGE_KEY, /^ps-ai-image-hub\.compat\./);
});
test("26 local selection switches this run to off without overwriting the remembered mode", () => { const panel = read("client/js/ui/mainPanel.js"); assert.match(panel, /applyAutoSharpenSelectionSafety\(isLocal\)[\s\S]*autoSharpenMode\.value = "off"/); assert.match(panel, /autoSharpenManager\.getMode\(\)/); assert.match(panel, /sourceType === "current-selection" \? "off"/); });
test("27 local generation never inherits remembered 100 percent sharpening", () => assert.match(read("client/js/ui/mainPanel.js"), /autoSharpenMode: this\.mainImage && this\.mainImage\.sourceType === "current-selection" \? "off"/));
test("28 manually requested local micro sharpen remains available", () => { const plan = buildAutoSharpenPlan("micro", { width: 900, height: 700 }, true); assert.equal(plan.enabled, true); assert.equal(plan.opacity, 100); assert.ok(plan.contract > 0); });
test("29 manually requested local custom 100 percent remains available", () => { const plan = buildAutoSharpenPlan("custom", { width: 900, height: 700 }, true, { customOpacity: 100 }); assert.equal(plan.opacity, 100); assert.ok(plan.feather > 0); });
test("30 local 100 percent keeps edge protection", () => { const plan = buildAutoSharpenPlan("custom", { width: 900, height: 700 }, true, { customOpacity: 100 }); assert.deepEqual({ contract: plan.contract, feather: plan.feather }, { contract: 14, feather: 14 }); });
test("31 repeated sharpening replaces the previous sharpen layer", () => { const host = read("host/host.jsx"); assert.match(host, /oldSharpenLayer = directLayerByName\(group, "AI生成图_锐化"/); assert.match(host, /oldSharpenLayer\.remove\(\)/); assert.match(host, /replacedExisting = true/); });
test("32 switching modes cannot stack a second sharpen layer", () => { const host = read("host/host.jsx"); assert.match(host, /sharpenLayer = originalLayer\.duplicate\(\)/); assert.match(host, /sharpenLayer\.name = "AI生成图_锐化"/); assert.doesNotMatch(host, /sharpenLayer\.duplicate\(/); });
test("33 parameter updates always duplicate the original layer", () => assert.match(read("host/host.jsx"), /sharpenLayer = originalLayer\.duplicate\(\)/));
test("34 High Pass is never applied to the old sharpen copy", () => { const host = read("host/host.jsx"); assert.match(host, /sharpenLayer\.applyHighPass\(safeRadius\)/); assert.doesNotMatch(host, /oldSharpenLayer\.applyHighPass/); });
test("35 failure removes the newly-created partial sharpen layer", () => assert.match(read("host/host.jsx"), /if \(sharpenLayer\).*sharpenLayer\.remove\(\)/));
test("36 failure preserves and restores the original layer", () => { const host = read("host/host.jsx"); assert.match(host, /originalLayer\.move\(group, ElementPlacement\.PLACEBEFORE\)/); assert.match(host, /targetDocument\.activeLayer = originalLayer/); });
test("37 sharpen failure does not fail a successful import", async () => {
  const importer = new ImageImporter({
    photoshopBridge: { isAvailable() { return true; }, resolveExtensionAsset() { return "mock.png"; }, importImage() { return Promise.resolve({ imported: true, layerName: "AI", documentName: "Doc", finalBounds: { width: 1000, height: 1000 } }); } },
    autoSharpenManager: { applyToImportedLayer() { return Promise.resolve({ applied: false, failed: true, message: "图片已成功导入，但自动清晰化未完成。" }); } }
  });
  const result = await importer.importImages([{ importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" } }], { autoSharpenMode: "natural" });
  assert.equal(result.imported, true); assert.equal(result.autoSharpenResults[0].failed, true);
});
test("38 undo-safe structure never merges or edits original pixels", () => { const source = read("host/host.jsx"); const host = source.slice(source.indexOf("api.applyAutoSharpen"), source.indexOf("api._nextGeneratedLayerNameFromNames")); assert.doesNotMatch(host, /\.merge\(|originalLayer\.applyHighPass|originalLayer\.desaturate/); });
test("39 saved PSD structure uses a group plus independent original and sharpen layers", () => { const host = read("host/host.jsx"); assert.match(host, /group\.name = "AI生成图_清晰化"/); assert.match(host, /sharpenLayer\.name = "AI生成图_锐化"/); assert.match(host, /originalLayer\.move\(group, ElementPlacement\.INSIDE\)/); });
test("40 official storage excludes Lab namespaces", () => { const source = fs.readdirSync(path.join(runtime, "client/js/storage")).map((name) => read("client/js/storage/" + name)).join("\n") + read("client/js/presets/promptPresetStore.js"); assert.doesNotMatch(source, /ps-ai-image-hub\.autosharpen\.lab\.cep11/); assert.match(source, /ps-ai-image-hub\.compat\.cep11/); });
test("41 official Extension ID remains unchanged", () => { const manifest = read("CSXS/manifest.xml"); assert.match(manifest, /com\.psai\.imagehub\.compat\.cep11\.panel/); assert.doesNotMatch(manifest, /autosharpen\.lab/); });
test("42 automatic radius still clamps to 0.7 and 3.0", () => { assert.equal(calculateAutoSharpenRadius(200, 300), 0.7); assert.equal(calculateAutoSharpenRadius(9000, 4200), 3); });
test("43 edge protection keeps all four size bands", () => { assert.deepEqual(calculateAutoSharpenEdgeProtection(400, 500), { contract: 8, feather: 8 }); assert.deepEqual(calculateAutoSharpenEdgeProtection(800, 900), { contract: 14, feather: 14 }); assert.deepEqual(calculateAutoSharpenEdgeProtection(1500, 1700), { contract: 24, feather: 24 }); assert.deepEqual(calculateAutoSharpenEdgeProtection(3000, 4000), { contract: 40, feather: 40 }); });
test("44 local mask contracts inward and feathers", () => { const host = read("host/host.jsx"); assert.match(host, /pixels\(originalSelection\[0\]\) \+ safeContract/); assert.match(host, /targetDocument\.selection\.feather\(safeFeather\)/); assert.match(host, /createRevealSelectionMask\(\)/); });
test("45 manager sends safe custom parameters through the bridge", async () => { let captured; const manager = new AutoSharpenManager({ photoshopBridge: { applyAutoSharpen(name, plan) { captured = { name, plan }; return Promise.resolve({ replacedExisting: true }); } } }); const result = await manager.applyToImportedLayer({ layerName: "AI_Generated_001", finalBounds: { width: 2048, height: 1024 } }, { mode: "custom", preferences: { customRadiusMode: "manual", customManualRadius: 0.6, customBlendMode: "linearLight", customOpacity: 100 } }); assert.equal(result.applied, true); assert.equal(captured.plan.radius, 0.6); assert.equal(captured.plan.opacity, 100); });
test("46 manual action stays available for safe parameter replacement", () => { const panel = read("client/js/ui/mainPanel.js"); assert.match(panel, /manual-sharpen-button/); assert.doesNotMatch(panel, /alreadySharpened/); });
test("47 provider request payload remains untouched", () => { const generation = read("client/js/generation/generationManager.js"); assert.match(generation, /autoSharpenMode: input\.autoSharpenMode \|\| "off"/); assert.doesNotMatch(read("client/js/generation/requestBuilder.js"), /autoSharpen/); });
test("48 bridge allowlist carries the optional desaturation flag", () => { assert.match(read("client/js/photoshop/bridgeSerialization.js"), /applyAutoSharpen: 8/); assert.match(read("client/js/photoshop/bridge.js"), /suppressColorFringing === true/); });
test("49 custom UI exposes exact radius, blend and opacity controls", () => { const panel = read("client/js/ui/mainPanel.js"); assert.match(panel, /id="custom-radius".*min="0\.1".*max="10\.0".*step="0\.1"/); assert.match(panel, /value="softLight"/); assert.match(panel, /id="custom-opacity-range".*min="0".*max="100"/); });
test("50 failed replacement keeps the previous sharpen layer until the new copy is ready", () => { const host = read("host/host.jsx"); assert.ok(host.indexOf("sharpenLayer.applyHighPass") < host.indexOf("oldSharpenLayer.remove")); assert.match(host, /if \(sharpenLayer\).*sharpenLayer\.remove/); });
test("51 local forced-off UI shows color-fringing suppression unchecked", () => {
  const state = buildAutoSharpenUiState("off", { suppressColorFringing: true });
  assert.equal(state.suppressColorFringingChecked, false);
});
test("52 local forced-off UI disables color-fringing suppression", () => {
  assert.equal(buildAutoSharpenUiState("off", { suppressColorFringing: true }).suppressColorFringingDisabled, true);
});
test("53 temporary forced-off UI preserves the stored color-fringing preference", () => {
  const storage = memoryStorage();
  const store = new AutoSharpenPreferenceStore({ storage });
  store.setPreferences({ mode: "micro", suppressColorFringing: true });
  const state = buildAutoSharpenUiState("off", store.getPreferences());
  assert.equal(state.savedSuppressColorFringing, true);
  assert.equal(store.getPreferences().suppressColorFringing, true);
});
test("54 returning to full-image mode restores the remembered color-fringing display", () => {
  const saved = { mode: "micro", suppressColorFringing: true };
  assert.equal(buildAutoSharpenUiState("off", saved).suppressColorFringingChecked, false);
  assert.equal(buildAutoSharpenUiState(saved.mode, saved).suppressColorFringingChecked, true);
});
test("55 Chinese UI localizes all custom blend-mode names", () => {
  assert.deepEqual([zhCN.autoSharpenSoftLight, zhCN.autoSharpenOverlay, zhCN.autoSharpenLinearLight], ["柔光", "叠加", "线性光"]);
});
test("56 English UI keeps all custom blend-mode names in English", () => {
  assert.deepEqual([enUS.autoSharpenSoftLight, enUS.autoSharpenOverlay, enUS.autoSharpenLinearLight], ["Soft Light", "Overlay", "Linear Light"]);
});
test("57 localized blend labels do not change stable internal values", () => {
  const panel = read("client/js/ui/mainPanel.js");
  assert.match(panel, /value="softLight">\$\{this\.t\("autoSharpenSoftLight"\)\}/);
  assert.match(panel, /value="overlay">\$\{this\.t\("autoSharpenOverlay"\)\}/);
  assert.match(panel, /value="linearLight">\$\{this\.t\("autoSharpenLinearLight"\)\}/);
});
test("58 off mode disables the manual sharpen button", () => {
  const panel = read("client/js/ui/mainPanel.js");
  assert.match(panel, /manualSharpenButton\.disabled = !\(this\.currentResult[\s\S]*sharpeningEnabled\)/);
  assert.equal(buildAutoSharpenUiState("off", {}).sharpeningEnabled, false);
});
test("59 every supported sharpening mode enables the manual action", () => {
  ["micro", "natural", "standard", "strong", "custom"].forEach((mode) => assert.equal(buildAutoSharpenUiState(mode, {}).sharpeningEnabled, true));
});
test("60 direct off or invalid manager execution safely skips without invoking Photoshop", async () => {
  let calls = 0;
  const manager = new AutoSharpenManager({ photoshopBridge: { applyAutoSharpen() { calls += 1; } } });
  for (const mode of ["off", "none", "", "unknown"]) {
    assert.deepEqual(await manager.applyToImportedLayer({ layerName: "AI" }, { mode }), { applied: false, success: false, skipped: true, reason: "sharpening-disabled" });
  }
  assert.equal(calls, 0);
});
test("61 host disabled guard runs before any document, group, copy or layer mutation", () => {
  const host = read("host/host.jsx");
  const start = host.indexOf("api.applyAutoSharpen");
  const guard = host.indexOf('reason: "sharpening-disabled"', start);
  assert.ok(guard > start);
  ["app.documents.length", "originalLayer.duplicate", "layerSets.add", "oldSharpenLayer.remove"].forEach((needle) => assert.ok(guard < host.indexOf(needle, start), needle));
});
test("62 local selection forced-off state disables both suppression and manual action", () => {
  const state = buildAutoSharpenUiState("off", { mode: "micro", suppressColorFringing: true });
  assert.equal(state.suppressColorFringingDisabled, true);
  assert.equal(state.sharpeningEnabled, false);
});
test("63 off state disables mode-specific parameter controls and valid states enable only their own controls", () => {
  assert.deepEqual({ micro: buildAutoSharpenUiState("off", {}).microControlsDisabled, custom: buildAutoSharpenUiState("off", {}).customControlsDisabled }, { micro: true, custom: true });
  assert.equal(buildAutoSharpenUiState("micro", {}).microControlsDisabled, false);
  assert.equal(buildAutoSharpenUiState("custom", {}).customControlsDisabled, false);
});
test("64 rapid mode transitions always derive controls and button state from the latest effective mode", () => {
  const states = ["micro", "off", "custom", "off", "natural"].map((mode) => buildAutoSharpenUiState(mode, { suppressColorFringing: true }));
  assert.deepEqual(states.map((state) => state.sharpeningEnabled), [true, false, true, false, true]);
  assert.deepEqual(states.map((state) => state.suppressColorFringingChecked), [true, false, true, false, true]);
});
