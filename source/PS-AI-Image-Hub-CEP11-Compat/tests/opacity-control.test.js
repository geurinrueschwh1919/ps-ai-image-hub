"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MainPanel } = require("../client/js/ui/mainPanel");
const { AutoSharpenManager, AutoSharpenPreferenceStore, buildAutoSharpenPlan,
  normalizeAutoSharpenPreferences } = require("../client/js/photoshop/autoSharpenManager");
const { PhotoshopBridge } = require("../client/js/photoshop/bridge");

const runtime = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(runtime, relative), "utf8");

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}

function opacityPanel() {
  const progress = {};
  const panel = Object.create(MainPanel.prototype);
  panel.customOpacityRange = { value: "", style: { setProperty(key, value) { progress[key] = value; } } };
  panel.customOpacityInput = { value: "" };
  panel.customOpacityValue = { textContent: "" };
  panel.progress = progress;
  return panel;
}

test("opacity 1 range declares the inclusive 0..100 integer contract", () => {
  assert.match(read("client/js/ui/mainPanel.js"), /id="custom-opacity-range"[^>]*min="0"[^>]*max="100"[^>]*step="1"/);
});

test("opacity 2 right endpoint normalizes to 100 and fills the visual track", () => {
  const panel = opacityPanel();
  assert.equal(panel.syncCustomOpacityUi(100), 100);
  assert.equal(panel.customOpacityRange.value, "100");
  assert.equal(panel.progress["--range-progress"], "100%");
});

test("opacity 3 numeric 100 is persisted without 0.99 conversion", () => {
  const store = new AutoSharpenPreferenceStore({ storage: memoryStorage() });
  assert.equal(store.setPreferences({ mode: "custom", customOpacity: 100 }).customOpacity, 100);
});

test("opacity 4 persisted 100 restores after store reload", () => {
  const storage = memoryStorage();
  new AutoSharpenPreferenceStore({ storage }).setPreferences({ mode: "custom", customOpacity: 100 });
  assert.equal(new AutoSharpenPreferenceStore({ storage }).getPreferences().customOpacity, 100);
});

test("opacity 5 exact readout explicitly displays 100 percent", () => {
  const panel = opacityPanel(); panel.syncCustomOpacityUi("100");
  assert.equal(panel.customOpacityValue.textContent, "100%");
});

test("opacity 6 manager passes numeric 100 to the Photoshop bridge", async () => {
  let sent = null;
  const manager = new AutoSharpenManager({ photoshopBridge: { applyAutoSharpen(name, plan) { sent = plan.opacity; return Promise.resolve({}); } } });
  await manager.applyToImportedLayer({ layerName: "AI", finalBounds: { width: 1200, height: 800 } },
    { mode: "custom", preferences: { customBlendMode: "linearLight", customOpacity: 100 } });
  assert.equal(sent, 100);
});

test("opacity 7 bridge serialization preserves the 100 argument", async () => {
  let script = "";
  const bridge = new PhotoshopBridge({ csInterface: { evalScript(value, callback) { script = value; callback('{"ok":true,"data":{}}'); } } });
  await bridge.applyAutoSharpen("AI", { blendMode: "linearLight", opacity: 100, radius: 0.5 });
  assert.match(script, /applyAutoSharpen\("AI","linearLight","100","0\.5"/);
});

test("opacity 8 host accepts and assigns Photoshop layer opacity 100", () => {
  const host = read("host/host.jsx");
  assert.match(host, /safeOpacity >= 0 && safeOpacity <= 100/);
  assert.match(host, /sharpenLayer\.opacity = safeOpacity/);
});

test("opacity 9 normalization keeps 99 and 100 distinct", () => {
  assert.equal(normalizeAutoSharpenPreferences({ customOpacity: 99 }).customOpacity, 99);
  assert.equal(normalizeAutoSharpenPreferences({ customOpacity: 100 }).customOpacity, 100);
});

test("opacity 10 custom Linear Light at 100 remains custom", () => {
  const plan = buildAutoSharpenPlan("custom", {}, false, { customBlendMode: "linearLight", customOpacity: 100 });
  assert.deepEqual({ mode: plan.mode, blendMode: plan.blendMode, opacity: plan.opacity }, { mode: "custom", blendMode: "linearLight", opacity: 100 });
});

test("opacity 11 micro remains Linear Light at 100", () => {
  const plan = buildAutoSharpenPlan("micro", {}, false);
  assert.deepEqual({ mode: plan.mode, blendMode: plan.blendMode, opacity: plan.opacity }, { mode: "micro", blendMode: "linearLight", opacity: 100 });
});

test("opacity 12 both 0 and 100 boundaries are legal and inclusive", () => {
  assert.equal(buildAutoSharpenPlan("custom", {}, false, { customOpacity: 0 }).opacity, 0);
  assert.equal(buildAutoSharpenPlan("custom", {}, false, { customOpacity: 100 }).opacity, 100);
});
