"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../client/js/providers/grsModelCatalog");
const { buildGenerationRequest } = require("../client/js/generation/requestBuilder");
const { buildGrsHttpRequest, normalizeGrsConfig, GrsProvider } = require("../client/js/providers/grsProvider");
const { ImagePayloadOptimizer, IMAGE_OPTIMIZATION_PROFILES, PLUGIN_SOFT_PAYLOAD_TARGET, targetImageDimensions, rawImageApiValue } = require("../client/js/generation/imagePayloadOptimizer");
const { ApiClient, API_TIMEOUTS } = require("../client/js/network/apiClient");
const { ErrorCodes, toUserMessage } = require("../client/js/utils/errors");
const { GenerationManager } = require("../client/js/generation/generationManager");

function input(id, width, height, length, mimeType) {
  const value = "A".repeat(length || 4);
  return { id, width, height, mimeType: mimeType || "image/jpeg", base64: value, apiValue: value };
}

function fakeCodec(calls) {
  return {
    async transform(source, profile, context) {
      calls.push({ id: source.id, role: context.role, maxDimension: profile.maxDimension, jpegQuality: profile.jpegQuality });
      const target = targetImageDimensions(source.width, source.height, profile.maxDimension);
      const key = context.role + "-" + profile.maxDimension;
      const length = source.outputLengths && source.outputLengths[key] || 4;
      const raw = "A".repeat(Math.max(4, Math.ceil(length / 4) * 4));
      return Object.assign({}, source, { width: target.width, height: target.height, mimeType: "image/jpeg", base64: raw,
        apiValue: raw, apiTemporaryCopy: true, optimization: { jpegQuality: profile.jpegQuality, resized: target.resized, encodeMs: 2 } });
    }
  };
}

function optimizer(softTargetBytes, calls) {
  return new ImagePayloadOptimizer({ softTargetBytes, codec: fakeCodec(calls || []) });
}

test("gpt-image-2 exposes only the confirmed 1K resolutionTier", () => {
  assert.deepEqual(catalog.getGrsModel("gpt-image-2").resolutionTiers, ["1K"]);
});

test("gpt-image-2-vip exposes confirmed 1K, 2K, and 4K resolutionTiers", () => {
  assert.deepEqual(catalog.getGrsModel("gpt-image-2-vip").resolutionTiers, ["1K", "2K", "4K"]);
});

test("GPT New API maps output resolution through aspectRatio", () => {
  const regular = catalog.getGrsModel("gpt-image-2").newApiCapabilities;
  const vip = catalog.getGrsModel("gpt-image-2-vip").newApiCapabilities;
  assert.equal(regular.resolutionTierField, "aspectRatio");
  assert.equal(regular.resolutionMappingStatus, "CONFIRMED_RATIO_OR_1K_PIXEL");
  assert.equal(vip.resolutionTierField, "aspectRatio");
  assert.equal(vip.resolutionMappingStatus, "CONFIRMED_PIXEL_MATRIX");
});

for (const tier of ["2K", "4K"]) {
  test("gpt-image-2-vip keeps UI selection " + tier + " without sending Nano imageSize", () => {
    const request = buildGenerationRequest({ providerId: "grs", modelId: "gpt-image-2-vip", prompt: "p", aspectRatio: "16:9", resolutionTier: tier });
    const body = JSON.parse(buildGrsHttpRequest(request, normalizeGrsConfig(), "key", catalog.getGrsModel(request.modelId)).body);
    assert.equal(request.resolutionTier, tier);
    assert.equal(Object.hasOwn(body, "imageSize"), false);
  });
}

test("Main Panel reads neutral resolutionTiers instead of GPT supportedImageSizes", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /model\.resolutionTiers/);
  assert.match(source, /resolutionTier:\s*this\.imageSizeField/);
});

test("gpt-image-2-vip Resolution UI is visible with three selectable tiers", () => {
  globalThis.PSAIImageHubCompat.refreshEnhancedSelect = function noop() {};
  require("../client/js/ui/mainPanel");
  const MainPanel = globalThis.PSAIImageHubCompat.MainPanel;
  const model = catalog.getGrsModel("gpt-image-2-vip");
  const provider = { id: "grs", getModel() { return model; }, getCapabilities() { return { supportsImageToImage: true }; } };
  const panel = { providerManager: { getProvider() { return provider; } }, providerSelect: { value: "grs" }, modelSelector: { getValue() { return model.id; } },
    aspectRatio: { value: "16:9" }, imageSizeField: { hidden: true }, imageSize: { value: "" }, references: [], mainImage: null, isGenerating: false,
    root: { querySelector() { return { disabled: false }; } }, t(key) { return key; },
    syncResolutionOptions: MainPanel.prototype.syncResolutionOptions,
    setOptions(select, values) { const previous = select.value; select.options = values.map((value) => ({ value: typeof value === "string" ? value : value.value }));
      select.value = select.options.some((option) => option.value === previous) ? previous : select.options[0] && select.options[0].value || ""; } };
  MainPanel.prototype.syncGenerationParameters.call(panel);
  assert.equal(panel.imageSizeField.hidden, false);
  assert.deepEqual(panel.imageSize.options.map((option) => option.value), ["1K", "2K", "4K"]);
});

for (const [ratio, tier, expected] of [
  ["16:9", "1K", "1280x720"],
  ["16:9", "2K", "2048x1152"],
  ["16:9", "4K", "3840x2160"],
  ["1:1", "4K", "2880x2880"],
  ["21:9", "4K", "3840x1648"]
]) {
  test("GPT VIP maps " + ratio + " + " + tier + " to " + expected, () => {
    const model = catalog.getGrsModel("gpt-image-2-vip");
    const request = buildGenerationRequest({ providerId: "grs", modelId: model.id, prompt: "p", aspectRatio: ratio, resolutionTier: tier });
    const body = JSON.parse(buildGrsHttpRequest(request, normalizeGrsConfig(), "key", model).body);
    assert.equal(body.aspectRatio, expected);
    assert.equal(Object.hasOwn(body, "imageSize"), false);
  });
}

test("GPT VIP 1:3 and 3:1 expose only documented 2K/4K tiers", () => {
  const model = catalog.getGrsModel("gpt-image-2-vip");
  assert.deepEqual(Object.keys(model.resolutionTiersByAspectRatio["1:3"]), ["2K", "4K"]);
  assert.deepEqual(Object.keys(model.resolutionTiersByAspectRatio["3:1"]), ["2K", "4K"]);
  assert.throws(() => buildGrsHttpRequest({ modelId: model.id, prompt: "p", aspectRatio: "1:3", resolutionTier: "1K" }, normalizeGrsConfig(), "key", model),
    (error) => error.code === ErrorCodes.INVALID_PROVIDER_CONFIG);
});

test("ordinary gpt-image-2 remains 1K-only and keeps official ratio strings", () => {
  const model = catalog.getGrsModel("gpt-image-2");
  const body = JSON.parse(buildGrsHttpRequest({ modelId: model.id, prompt: "p", aspectRatio: "16:9", resolutionTier: "1K" }, normalizeGrsConfig(), "key", model).body);
  assert.deepEqual(model.resolutionTiers, ["1K"]);
  assert.equal(body.aspectRatio, "16:9");
  assert.equal(Object.hasOwn(body, "imageSize"), false);
});

test("Nano resolutionTier still maps to documented imageSize", () => {
  const model = catalog.getGrsModel("nano-banana-2");
  const body = JSON.parse(buildGrsHttpRequest({ modelId: model.id, prompt: "p", aspectRatio: "16:9", resolutionTier: "4K", imageInputs: {} }, normalizeGrsConfig(), "key", model).body);
  assert.equal(body.imageSize, "4K");
  assert.equal(model.newApiCapabilities.resolutionTierField, "imageSize");
});

test("all confirmed Nano resolution tiers remain unchanged", () => {
  const expected = { "nano-banana-pro": ["1K", "2K", "4K"], "nano-banana-pro-vt": ["1K", "2K", "4K"], "nano-banana-2": ["1K", "2K", "4K"],
    "nano-banana-pro-cl": ["1K"], "nano-banana-2-cl": ["1K"], "nano-banana-2-2k-cl": ["2K"], "nano-banana-pro-vip": ["1K", "2K"],
    "nano-banana-pro-4k-vip": ["4K"], "nano-banana-2-4k-cl": ["4K"] };
  Object.entries(expected).forEach(([id, tiers]) => assert.deepEqual(catalog.getGrsModel(id).resolutionTiers, tiers));
  assert.equal(catalog.getGrsModel("nano-banana-fast").resolutionTiers, null);
  assert.equal(catalog.getGrsModel("nano-banana-2-lite").resolutionTiers, null);
});

test("small image is cloned without unnecessary resize or encode", async () => {
  const calls = [], source = input("small", 1600, 900, 400);
  const result = await optimizer(1024, calls).optimize({ mainImage: null, referenceImages: [source] });
  assert.equal(calls.length, 0);
  assert.notEqual(result.imageInputs.referenceImages[0], source);
  assert.deepEqual(result.metrics.sentDimensions[0], { role: "reference", index: 0, width: 1600, height: 900 });
});

test("Pass 1 keeps a 2560x1440 Main Image at full input dimensions", async () => {
  const calls = [], source = Object.assign(input("main", 2560, 1440, 1000), { outputLengths: { "main-2560": 100 } });
  const result = await optimizer(200, calls).optimize({ mainImage: source, referenceImages: [] });
  assert.deepEqual(result.metrics.sentDimensions[0], { role: "main", index: 0, width: 2560, height: 1440 });
  assert.equal(calls[0].jpegQuality, 0.92);
});

test("Pass 1 resizes a 2560x1440 Reference to 2048x1152", async () => {
  const calls = [], source = Object.assign(input("ref", 2560, 1440, 1000), { outputLengths: { "reference-2048": 100 } });
  const result = await optimizer(200, calls).optimize({ referenceImages: [source] });
  assert.deepEqual(result.metrics.sentDimensions[0], { role: "reference", index: 0, width: 2048, height: 1152 });
  assert.equal(calls[0].jpegQuality, 0.90);
});

test("Main plus Reference preserves order and source objects", async () => {
  const calls = [];
  const main = Object.assign(input("main", 2560, 1440, 1000), { outputLengths: { "main-2560": 100 } });
  const ref = Object.assign(input("ref", 2560, 1440, 1000), { outputLengths: { "reference-2048": 100 } });
  const beforeMain = main.apiValue, beforeRef = ref.apiValue;
  const result = await optimizer(300, calls).optimize({ mainImage: main, referenceImages: [ref] });
  assert.deepEqual([result.imageInputs.mainImage.id, result.imageInputs.referenceImages[0].id], ["main", "ref"]);
  assert.equal(main.apiValue, beforeMain); assert.equal(ref.apiValue, beforeRef);
  assert.equal(main.width, 2560); assert.equal(ref.width, 2560);
});

test("Main plus two References keeps stable reference order", async () => {
  const calls = [], make = (id, role) => Object.assign(input(id, 3000, 2000, 1000), { outputLengths: { [role + (role === "main" ? "-2560" : "-2048")]: 100 } });
  const result = await optimizer(500, calls).optimize({ mainImage: make("main", "main"), referenceImages: [make("r1", "reference"), make("r2", "reference")] });
  assert.deepEqual([result.imageInputs.mainImage.id, ...result.imageInputs.referenceImages.map((item) => item.id)], ["main", "r1", "r2"]);
});

test("resize preserves aspect ratio without crop or stretch", () => {
  const target = targetImageDimensions(3840, 2160, 2048);
  assert.deepEqual(target, { width: 2048, height: 1152, resized: true });
  assert.equal(target.width / target.height, 3840 / 2160);
});

test("Main quality is higher than Reference quality in both passes", () => {
  assert.ok(IMAGE_OPTIMIZATION_PROFILES.pass1.main.jpegQuality > IMAGE_OPTIMIZATION_PROFILES.pass1.reference.jpegQuality);
  assert.ok(IMAGE_OPTIMIZATION_PROFILES.pass2.main.jpegQuality > IMAGE_OPTIMIZATION_PROFILES.pass2.reference.jpegQuality);
});

test("Pass 2 runs only when Pass 1 remains above the soft target", async () => {
  const calls = [];
  const main = Object.assign(input("main", 3000, 2000, 1000), { outputLengths: { "main-2560": 120 } });
  const result = await optimizer(200, calls).optimize({ mainImage: main, referenceImages: [] });
  assert.equal(result.metrics.passCount, 1);
  assert.equal(calls.length, 1);
});

test("Pass 2 compresses References before reducing Main", async () => {
  const calls = [];
  const main = Object.assign(input("main", 3000, 2000, 1000), { outputLengths: { "main-2560": 300, "main-2048": 100 } });
  const ref = Object.assign(input("ref", 3000, 2000, 1000), { outputLengths: { "reference-2048": 200, "reference-1600": 48 } });
  const result = await optimizer(400, calls).optimize({ mainImage: main, referenceImages: [ref] });
  assert.equal(result.metrics.passCount, 2);
  assert.equal(calls.some((call) => call.role === "reference" && call.maxDimension === 1600), true);
  assert.equal(calls.some((call) => call.role === "main" && call.maxDimension === 2048), false);
  assert.equal(result.imageInputs.mainImage.width, 2560);
});

test("Pass 2 uses Main 2048/.88 and Reference 1600/.85 only when still necessary", async () => {
  const calls = [];
  const main = Object.assign(input("main", 3000, 2000, 1000), { outputLengths: { "main-2560": 300, "main-2048": 100 } });
  const ref = Object.assign(input("ref", 3000, 2000, 1000), { outputLengths: { "reference-2048": 200, "reference-1600": 100 } });
  const result = await optimizer(250, calls).optimize({ mainImage: main, referenceImages: [ref] });
  assert.equal(result.imageInputs.mainImage.width, 2048);
  assert.equal(result.imageInputs.referenceImages[0].width, 1600);
  assert.ok(calls.some((call) => call.role === "main" && call.maxDimension === 2048 && call.jpegQuality === 0.88));
  assert.ok(calls.some((call) => call.role === "reference" && call.maxDimension === 1600 && call.jpegQuality === 0.85));
});

test("Data URL prefix is stripped and raw Base64 remains valid", () => {
  assert.equal(rawImageApiValue({ apiValue: "data:image/png;base64,QUJD" }), "QUJD");
  assert.doesNotThrow(() => Buffer.from(rawImageApiValue({ apiValue: "data:image/png;base64,QUJD" }), "base64"));
});

test("soft payload target is plugin-owned 16 MiB", () => assert.equal(PLUGIN_SOFT_PAYLOAD_TARGET, 16 * 1024 * 1024));

test("large 2x2560x1440 fixture drops from about 42.7 MiB while keeping fidelity dimensions", async () => {
  const calls = [];
  const rawLength = 22_369_624;
  const main = Object.assign(input("main", 2560, 1440, rawLength), { outputLengths: { "main-2560": 4_000_000 } });
  const ref = Object.assign(input("ref", 2560, 1440, rawLength), { outputLengths: { "reference-2048": 3_000_000 } });
  const result = await optimizer(PLUGIN_SOFT_PAYLOAD_TARGET, calls).optimize({ mainImage: main, referenceImages: [ref] });
  assert.ok(result.metrics.beforeOptimizationPayloadBytes > 42 * 1024 * 1024);
  assert.ok(result.metrics.afterOptimizationPayloadBytes < 8 * 1024 * 1024);
  assert.ok(result.metrics.reductionPercent > 80);
  assert.deepEqual(result.metrics.sentDimensions, [
    { role: "main", index: 0, width: 2560, height: 1440 },
    { role: "reference", index: 0, width: 2048, height: 1152 }
  ]);
});

function xhrResponse(status, body, observations) {
  return function factory() {
    return { status: 0, responseText: "", timeout: 0, open() {}, setRequestHeader() {}, send() {
      observations.sendCount += 1;
      queueMicrotask(() => { this.status = status; this.responseText = body; this.onload(); });
    }, abort() { if (this.onabort) this.onabort(); } };
  };
}

test("HTTP 413 maps immediately to PAYLOAD_TOO_LARGE", async () => {
  const observations = { sendCount: 0 }, client = new ApiClient({ xhrFactory: xhrResponse(413, "413 Request Entity Too Large", observations) });
  const started = Date.now();
  await assert.rejects(client.requestJson("https://example.test/generate", { timeout: 600000, timeoutContext: "generation" }),
    (error) => error.code === ErrorCodes.PAYLOAD_TOO_LARGE && error.details.status === 413);
  assert.ok(Date.now() - started < 1000);
});

test("HTTP 413 user message never suggests API Key or Model ID", () => {
  const text = toUserMessage({ code: ErrorCodes.PAYLOAD_TOO_LARGE, message: "413", details: { provider: "GRS", status: 413 } },
    (key) => key === "errorPayloadTooLarge" ? "图片请求仍然过大。请减少参考图数量。" : key);
  assert.match(text, /图片请求仍然过大/);
  assert.doesNotMatch(text, /API Key|Model ID|额度/);
});

test("GRS 413 never enters polling or task recovery", async () => {
  const observations = { sendCount: 0 };
  const instance = new GrsProvider(null, { apiClient: new ApiClient({ xhrFactory: xhrResponse(413, "nginx 413", observations) }),
    secretStore: { get() { return "test-key"; } }, pollingManager: { poll() { throw new Error("polling must not run"); } }, setInterval() { return 1; }, clearInterval() {} });
  await assert.rejects(instance.generate({ modelId: "gpt-image-2-vip", prompt: "p", aspectRatio: "1024x1024", resolutionTier: "4K", imageInputs: {} }),
    (error) => error.code === ErrorCodes.PAYLOAD_TOO_LARGE && error.details.canRecover === false);
  assert.equal(observations.sendCount, 1);
});

test("H1 timeout budgets remain 600000/25000/60000", () => {
  assert.equal(API_TIMEOUTS.generation, 600000);
  assert.equal(API_TIMEOUTS.connection, 25000);
  assert.equal(API_TIMEOUTS.download, 60000);
});

test("request diagnostics include preflight, XHR, task, and result lifecycle without secrets", async () => {
  const observations = { sendCount: 0 }, captured = [], original = console.log;
  console.log = function capture() { captured.push(Array.from(arguments)); };
  try {
    const instance = new GrsProvider(null, { apiClient: new ApiClient({ xhrFactory: xhrResponse(200, JSON.stringify({ id: "task-h2", status: "succeeded", results: [{ url: "https://files.example/result.png" }] }), observations) }),
      secretStore: { get() { return "sk-h2-secret-not-real"; } }, setInterval() { return 1; }, clearInterval() {} });
    await instance.generate({ modelId: "nano-banana-2", prompt: "p", aspectRatio: "1:1", resolutionTier: "1K",
      imageInputs: { mainImage: input("main", 128, 128, 4), referenceImages: [] }, imageOptimization: { mainImageCount: 1, referenceCount: 0,
        sourceDimensions: [{ role: "main", width: 128, height: 128 }], sentDimensions: [{ role: "main", width: 128, height: 128 }],
        encodedBytesPerImage: [{ role: "main", bytes: 4 }], beforeOptimizationPayloadBytes: 8, afterOptimizationPayloadBytes: 8, reductionPercent: 0, passCount: 0 } });
  } finally { console.log = original; }
  const output = JSON.stringify(captured);
  for (const event of ["IMAGE_PAYLOAD_PREFLIGHT", "REQUEST_BODY_READY", "XHR_SEND_ENTERED", "XHR_REQUEST_STARTED", "XHR_RESPONSE_RECEIVED", "TASK_ID_RECEIVED", "RESULT_URL_RECEIVED"]) assert.match(output, new RegExp(event));
  assert.doesNotMatch(output, /sk-h2-secret-not-real|AAAA/);
});

test("GenerationManager emits image prepare lifecycle", async () => {
  const captured = [], original = console.log;
  console.log = function capture() { captured.push(Array.from(arguments)); };
  const provider = { id: "test", getModels() { return [{ id: "m" }]; }, validateConfig() { return { valid: true }; },
    async generate() { return { status: "succeeded", results: [] }; }, parseResponse(value) { return value; }, extractImages() {
      return [{ id: "x", mimeType: "image/png", previewSource: "assets/mock-result.png", importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" } }];
    } };
  const manager = new GenerationManager({ providerManager: { requireProvider() { return provider; } }, t: (key) => key,
    imagePayloadOptimizer: { async optimize(set) { return { imageInputs: set, metrics: { imageCount: 1, mainImageCount: 1, referenceCount: 0,
      sourceDimensions: [], sentDimensions: [], encodedBytesPerImage: [], beforeOptimizationPayloadBytes: 4, afterOptimizationPayloadBytes: 4,
      reductionPercent: 0, passCount: 0, optimizeMs: 1, encodeMs: 0 } }; } } });
  try { await manager.generateOneClick({ providerId: "test", modelId: "m", prompt: "p", imageInputs: { mainImage: input("m", 1, 1, 4), referenceImages: [] } }, {}); }
  finally { console.log = original; }
  const output = JSON.stringify(captured);
  assert.match(output, /IMAGE_PREPARE_STARTED/); assert.match(output, /IMAGE_PREPARE_DONE/);
});

test("download and Photoshop import completion diagnostics are emitted", async () => {
  const captured = [], original = console.log;
  console.log = function capture() { captured.push(Array.from(arguments)); };
  const manager = new GenerationManager({ providerManager: {}, t: (key) => key, imageImporter: { supportsProgressCallbacks: true,
    async importImages(images, options) { options.onDiagnostic("RESULT_DOWNLOAD_DONE", { downloadMs: 5 }); return { imported: true, layerNames: ["AI Generated Image"] }; } } });
  const result = { providerId: "grs", modelId: "m", images: [{ id: "x" }], importState: "notImported" };
  try { await manager.importGeneratedResult(result, { pipelineTimings: { downloadMs: 0, importMs: 0 } }); }
  finally { console.log = original; }
  const output = JSON.stringify(captured);
  assert.match(output, /RESULT_DOWNLOAD_DONE/); assert.match(output, /PHOTOSHOP_IMPORT_DONE/);
});
