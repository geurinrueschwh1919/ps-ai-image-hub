"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtime = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(runtime, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(runtime, relative));
const runtimeFiles = [
  "client/index.html",
  "client/js/app.js",
  "client/js/ui/mainPanel.js",
  "client/js/generation/generationManager.js",
  "client/js/photoshop/imageImporter.js",
  "client/js/photoshop/bridge.js",
  "client/js/photoshop/bridgeSerialization.js",
  "client/js/ui/statusView.js",
  "client/js/i18n/zh-CN.js",
  "client/js/i18n/en-US.js",
  "client/js/storage/storageManager.js",
  "host/host.jsx"
];
const runtimeText = () => runtimeFiles.map(read).join("\n");

test("1 Auto Color Fusion manager is absent", () => assert.equal(exists("client/js/photoshop/autoColorFusionManager.js"), false));
test("2 runtime HTML does not load the removed manager", () => assert.doesNotMatch(read("client/index.html"), /autoColorFusionManager/i));
test("3 generation UI has no Fusion checkbox", () => assert.doesNotMatch(read("client/js/ui/mainPanel.js"), /auto-color-fusion|autoColorFusion/i));
test("4 bootstrap creates no Fusion store or manager", () => assert.doesNotMatch(read("client/js/app.js"), /AutoColorFusion|autoColorFusion|BOOT_AUTO_COLOR_FUSION/));
test("5 generation pipeline carries no Fusion options or statuses", () => assert.doesNotMatch(read("client/js/generation/generationManager.js"), /autoColorFusion|FUSION_/));
test("6 image importer carries no Fusion dependency, result, or execution", () => assert.doesNotMatch(read("client/js/photoshop/imageImporter.js"), /autoColorFusion|FUSION_/));
test("7 bridge exposes no Fusion methods", () => assert.doesNotMatch(read("client/js/photoshop/bridge.js"), /ColorFusion|colorFusion/));
test("8 bridge allowlist exposes no Fusion methods", () => assert.doesNotMatch(read("client/js/photoshop/bridgeSerialization.js"), /ColorFusion|colorFusion/));
test("9 host exposes no Fusion APIs or temporary identifiers", () => assert.doesNotMatch(read("host/host.jsx"), /AutoColorFusion|ColorFusion|AUTO_COLOR_FUSION|PSAI_ACF/));
test("10 Fusion preference key and temporary directory are absent", () => assert.doesNotMatch(runtimeText(), /auto-color-fusion\.preferences|temp-color-fusion/));
test("11 Chinese runtime dictionary has no Fusion strings", () => assert.doesNotMatch(read("client/js/i18n/zh-CN.js"), /autoColorFusion|色彩融合/));
test("12 English runtime dictionary has no Fusion strings", () => assert.doesNotMatch(read("client/js/i18n/en-US.js"), /autoColorFusion|Color Fusion|color fusion/i));
test("13 stale legacy Fusion storage is ignored because runtime never reads its key", () => {
  const legacyStorage = { "ps-ai-image-hub.compat.cep11.auto-color-fusion.preferences.v1": "{\"enabled\":true}" };
  assert.equal(Object.keys(legacyStorage).length, 1);
  assert.doesNotMatch(runtimeText(), /auto-color-fusion\.preferences/);
});
test("14 Auto Sharpen remains loaded and wired", () => {
  assert.match(read("client/index.html"), /autoSharpenManager\.js/);
  assert.match(read("client/js/app.js"), /new hub\.AutoSharpenManager/);
  assert.match(read("client/js/photoshop/imageImporter.js"), /applyToImportedLayer/);
});
test("15 History and Recovery modules remain loaded", () => {
  const index = read("client/index.html");
  assert.match(index, /historyStore\.js/);
  assert.match(index, /generationRecoveryStore\.js/);
});
test("16 Prompt Preset modules remain loaded", () => {
  const index = read("client/index.html");
  assert.match(index, /promptPresetRegistry\.js/);
  assert.match(index, /promptPresetPanel\.js/);
});
test("17 Persistent Panel remains loaded", () => assert.match(read("client/index.html"), /persistentPanel\.js/));
test("18 Alibaba Cloud configuration pipeline remains present", () => {
  const provider = read("client/js/providers/aliyunBailianProvider.js");
  assert.match(provider, /endpointMode/);
  assert.match(provider, /providerConfigRevision/);
});
test("19 generic import target and composite-channel protections remain", () => {
  const host = read("host/host.jsx");
  const references = read("client/js/photoshop/referenceImageManager.js");
  const generation = read("client/js/generation/generationManager.js");
  assert.match(host, /function prepareImportTarget\(expectedDocumentId\)/);
  assert.match(host, /function activateCompositeChannels\(documentReference\)/);
  assert.match(host, /PHOTOSHOP_IMPORT_DOCUMENT_LOST/);
  assert.match(host, /documentId: documentId\(documentReference\)/);
  assert.match(references, /documentId: documentMetadata\.documentId/);
  assert.match(generation, /documentId: mainImage\.documentId/);
});
test("20 import still verifies exactly one new layer and uses no unscoped Show action", () => {
  const host = read("host/host.jsx");
  assert.match(host, /newLayerIds\.length !== 1/);
  assert.doesNotMatch(host, /executeAction\(charIDToTypeID\("Shw "\)/);
});
