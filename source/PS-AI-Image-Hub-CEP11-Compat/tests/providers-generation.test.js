"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranslator } = require("../client/js/i18n");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { ProviderManager } = require("../client/js/ui/providerManager");
const { GenerationManager } = require("../client/js/generation/generationManager");
const { AppError, ErrorCodes } = require("../client/js/utils/errors");

class StubImageImporter {
  constructor(results) {
    this.results = Array.isArray(results) ? results.slice() : [];
    this.calls = 0;
  }

  async importImages(images) {
    this.calls += 1;
    const next = this.results.length ? this.results.shift() : null;
    if (next instanceof Error) throw next;
    return next || { imported: true, imageCount: images.length, layerNames: ["AI_Generated_001"] };
  }
}

function createManager(options) {
  const registry = new ProviderRegistry();
  registry.register(new MockProvider({ submitDelay: 0, generationDelay: 0 }));
  const imageImporter = options && options.imageImporter || new StubImageImporter();
  return {
    registry,
    imageImporter,
    manager: new GenerationManager({
      providerManager: new ProviderManager(registry),
      imageImporter,
      t: createTranslator("zh-CN")
    })
  };
}

test("CEP Provider Registry registers and resolves Mock Provider", () => {
  const { registry } = createManager();
  assert.equal(registry.size, 1);
  assert.equal(registry.get("mock").getModels()[0].id, "mock-image-v1");
  assert.equal(registry.get("mock").getCapabilities().supportsTextToImage, true);
});

test("CEP Provider Registry refuses duplicate IDs", () => {
  const { registry } = createManager();
  assert.throws(() => registry.register(new MockProvider()), /already registered/);
});

test("CEP one-click Mock generation exposes the complete state sequence", async () => {
  const { manager } = createManager();
  const statuses = [];
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "  一座未来城市  ",
    aspectRatio: "1:1",
    autoOptimize: false
  }, { onStatus(status) { statuses.push(status); } });

  assert.deepEqual(statuses, ["validating", "submitting", "generating", "completed"]);
  assert.equal(result.prompt, "一座未来城市");
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].previewUrl, "assets/mock-result.png");
  assert.deepEqual(result.images[0].importSource, {
    type: "plugin-asset",
    relativePath: "client/assets/mock-result.png"
  });
  assert.equal(result.importState, "notImported");
});

test("CEP generation status observer exceptions cannot break generation", async () => {
  const { manager } = createManager();
  const result = await manager.generateOneClick({ providerId: "mock", modelId: "mock-image-v1", prompt: "observer" }, { onStatus() { throw new Error("UI callback failed"); } });
  assert.equal(result.images.length, 1);
});

test("CEP task recovery status observer exceptions cannot break recovery", async () => {
  const { manager, registry } = createManager();
  const provider = registry.get("mock");
  provider.recoverTask = async function recoverTask(taskId, options) {
    options.onStatus("polling", { taskId });
    return {
      providerId: "mock",
      modelId: "mock-image-v1",
      status: "completed",
      images: [{
        id: "recovered-mock",
        mimeType: "image/png",
        previewSource: "assets/mock-result.png",
        importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" }
      }]
    };
  };

  const result = await manager.recoverProviderTask("mock", "task-observer", {
    modelId: "mock-image-v1",
    onStatus() { throw new Error("Recovery UI callback failed"); }
  });
  assert.equal(result.images.length, 1);
});

test("CEP automatic import has independent generation and import states", async () => {
  const { manager, imageImporter } = createManager();
  const statuses = [];
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "自动导入",
    autoImport: true
  }, { onStatus(status) { statuses.push(status); } });

  assert.deepEqual(statuses, ["validating", "submitting", "generating", "completed", "importing", "imported"]);
  assert.equal(imageImporter.calls, 1);
  assert.equal(result.importState, "imported");
  assert.equal(result.importResult.layerNames[0], "AI_Generated_001");
});

test("CEP manual import reports importing then imported", async () => {
  const { manager } = createManager();
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "手动导入",
    autoImport: false
  });
  const statuses = [];

  await manager.importGeneratedResult(result, { onStatus(status) { statuses.push(status); } });
  assert.deepEqual(statuses, ["importing", "imported"]);
  assert.equal(result.importState, "imported");
});

test("CEP manual import status observer exceptions cannot break import", async () => {
  const { manager } = createManager();
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "手动导入回调隔离",
    autoImport: false
  });

  await manager.importGeneratedResult(result, { onStatus() { throw new Error("Import UI callback failed"); } });
  assert.equal(result.importState, "imported");
});

test("CEP failed automatic import retains the generated result and preview", async () => {
  const noDocument = new AppError(ErrorCodes.NO_PHOTOSHOP_DOCUMENT, "No document.");
  assert.equal(noDocument.code, "NO_PHOTOSHOP_DOCUMENT");
  const importer = new StubImageImporter([noDocument]);
  const { manager } = createManager({ imageImporter: importer });
  const statuses = [];
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "保留预览",
    autoImport: true
  }, { onStatus(status) { statuses.push(status); } });

  assert.equal(result.images[0].previewUrl, "assets/mock-result.png");
  assert.equal(result.importState, "failed");
  assert.equal(result.importError.code, ErrorCodes.NO_PHOTOSHOP_DOCUMENT);
  assert.equal(statuses.includes("completed"), true);
  assert.equal(statuses.at(-1), "importFailed");
});

test("CEP import can retry after a no-document failure and then succeed", async () => {
  const noDocument = new AppError(ErrorCodes.NO_PHOTOSHOP_DOCUMENT, "No document.");
  const importer = new StubImageImporter([
    noDocument,
    { imported: true, imageCount: 1, layerNames: ["AI_Generated_007"] }
  ]);
  const { manager } = createManager({ imageImporter: importer });
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "打开文档后重试",
    autoImport: false
  });

  await assert.rejects(
    manager.importGeneratedResult(result),
    (error) => error.code === ErrorCodes.NO_PHOTOSHOP_DOCUMENT
  );
  assert.equal(result.importState, "failed");
  await manager.importGeneratedResult(result);
  assert.equal(result.importState, "imported");
  assert.equal(result.importResult.layerNames[0], "AI_Generated_007");
});

test("CEP blocks a duplicate import after success", async () => {
  const { manager, imageImporter } = createManager();
  const result = await manager.generateOneClick({
    providerId: "mock",
    modelId: "mock-image-v1",
    prompt: "重复导入保护",
    autoImport: false
  });
  await manager.importGeneratedResult(result);

  await assert.rejects(
    manager.importGeneratedResult(result),
    (error) => error.code === ErrorCodes.RESULT_ALREADY_IMPORTED
  );
  assert.equal(imageImporter.calls, 1);
});

test("CEP manual import rejects a missing generated result", async () => {
  const { manager } = createManager();
  await assert.rejects(
    manager.importGeneratedResult(null),
    (error) => error.code === ErrorCodes.MISSING_GENERATED_RESULT
  );
});

test("CEP generation rejects an empty prompt with a stable error code", async () => {
  const { manager } = createManager();
  await assert.rejects(
    manager.generateOneClick({ providerId: "mock", modelId: "mock-image-v1", prompt: "   " }),
    (error) => error.code === ErrorCodes.PROMPT_REQUIRED
  );
});

test("CEP generation rejects an unregistered model", async () => {
  const { manager } = createManager();
  await assert.rejects(
    manager.generateOneClick({ providerId: "mock", modelId: "invented", prompt: "test" }),
    (error) => error.code === ErrorCodes.MODEL_REQUIRED
  );
});
