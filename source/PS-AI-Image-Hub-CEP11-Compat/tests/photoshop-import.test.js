"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ImageNormalizer } = require("../client/js/generation/imageNormalizer");
const { ImageImporter } = require("../client/js/photoshop/imageImporter");
const { ErrorCodes } = require("../client/js/utils/errors");
const { WIDTH, HEIGHT, buildPng, crc32 } = require("../scripts/create-mock-png");

const cepRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(cepRoot, "client", "assets", "mock-result.png");
const hostSource = fs.readFileSync(path.join(cepRoot, "host", "host.jsx"), "utf8");

function loadHost(overrides) {
  const context = Object.assign({
    isFinite,
    parseInt,
    Error
  }, overrides || {});
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  return context;
}

test("CEP bundled Mock fixture is a non-empty valid PNG", () => {
  const bytes = fs.readFileSync(fixturePath);
  assert.equal(bytes.length > 8, true);
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(bytes, buildPng());

  const idatParts = [];
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;
  while (offset < bytes.length) {
    assert.equal(offset + 12 <= bytes.length, true);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.equal(dataEnd + 4 <= bytes.length, true);
    const checksum = bytes.readUInt32BE(dataEnd);
    assert.equal(checksum, crc32(bytes.subarray(offset + 4, dataEnd)));
    if (type === "IHDR") sawIhdr = true;
    if (type === "IDAT") idatParts.push(bytes.subarray(dataStart, dataEnd));
    if (type === "IEND") sawIend = true;
    offset = dataEnd + 4;
  }
  assert.equal(offset, bytes.length);
  assert.equal(sawIhdr, true);
  assert.equal(sawIend, true);
  assert.equal(zlib.inflateSync(Buffer.concat(idatParts)).length, HEIGHT * (1 + WIDTH * 4));
});

test("CEP ImageNormalizer creates one preview/import contract for the Mock PNG", async () => {
  const normalizer = new ImageNormalizer();
  const images = await normalizer.normalizeAll([{
    id: "mock",
    mimeType: "image/png",
    sourceType: "plugin-asset",
    previewSource: "assets/mock-result.png",
    importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" },
    width: 96,
    height: 96
  }]);

  assert.equal(images[0].previewSource, "assets/mock-result.png");
  assert.equal(images[0].previewUrl, images[0].previewSource);
  assert.equal(images[0].importSource.type, "plugin-asset");
  assert.equal(images[0].mimeType, "image/png");
});

test("CEP ImageNormalizer reserves a provider-neutral URL source without downloading it", () => {
  const normalizer = new ImageNormalizer();
  const image = normalizer.normalize({
    id: "future-url",
    url: "https://example.invalid/image.png",
    importSource: { type: "url", url: "https://example.invalid/image.png" }
  });
  assert.equal(image.previewSource, "https://example.invalid/image.png");
  assert.equal(image.importSource.type, "url");
});

test("CEP ImageImporter resolves the bundled PNG and returns structured layer data", async () => {
  const importedPaths = [];
  const bridge = {
    isAvailable() { return true; },
    resolveExtensionAsset(relativePath) {
      assert.equal(relativePath, "client/assets/mock-result.png");
      return 'C:\\用户 图片\\PS AI "Hub"\\client\\assets\\mock-result.png';
    },
    async importImage(localFilePath) {
      importedPaths.push(localFilePath);
      return {
        imported: true,
        layerName: "AI_Generated_003",
        layerType: "ArtLayer",
        documentName: "测试 文档.psd"
      };
    }
  };
  const importer = new ImageImporter({ photoshopBridge: bridge });
  const result = await importer.importImages([{
    importSource: { type: "plugin-asset", relativePath: "client/assets/mock-result.png" }
  }]);

  assert.equal(result.imported, true);
  assert.deepEqual(result.layerNames, ["AI_Generated_003"]);
  assert.equal(result.documentName, "测试 文档.psd");
  assert.equal(importedPaths[0], 'C:\\用户 图片\\PS AI "Hub"\\client\\assets\\mock-result.png');
});

test("CEP ImageImporter rejects a source that has no current local-file strategy", async () => {
  const importer = new ImageImporter({
    photoshopBridge: { isAvailable() { return true; } }
  });
  await assert.rejects(
    importer.importImages([{ importSource: { type: "url", url: "https://example.invalid/image.png" } }]),
    (error) => error.code === ErrorCodes.UNSUPPORTED_IMAGE_SOURCE
  );
});

test("ExtendScript next-layer helper scans existing generated layer numbers", () => {
  const host = loadHost();
  assert.equal(
    host.PSAIImageHubCompatHost._nextGeneratedLayerNameFromNames([
      "Background", "AI_Generated_002", "AI_Generated_014", "AI_Generated_bad"
    ]),
    "AI_Generated_015"
  );
  assert.equal(host.PSAIImageHubCompatHost._nextGeneratedLayerNameFromNames([]), "AI_Generated_001");
});

test("ExtendScript import returns a structured no-document error before file access", () => {
  const host = loadHost({ app: { documents: [] } });
  const response = JSON.parse(host.PSAIImageHubCompatHost.importImage("C:\\不存在也不应读取.png"));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "NO_PHOTOSHOP_DOCUMENT");
});

test("ExtendScript import rejects a corrupt PNG signature", () => {
  function InvalidFile(filePath) {
    return {
      exists: true,
      name: "mock-result.png",
      fsName: filePath,
      encoding: "UTF-8",
      open() { return true; },
      read() { return "not-a-pn"; },
      close() {}
    };
  }
  const host = loadHost({
    app: { documents: [{}], activeDocument: {} },
    File: InvalidFile
  });
  const response = JSON.parse(host.PSAIImageHubCompatHost.importImage("C:\\测试\\坏图片.png"));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "INVALID_PNG");
});

test("ExtendScript import duplicates exactly one ordinary layer and preserves existing layers", () => {
  const existingLayer = { name: "Background", typename: "ArtLayer" };
  const nestedLayer = { name: "AI_Generated_004", typename: "ArtLayer" };
  const group = { name: "Group", typename: "LayerSet", layers: [nestedLayer] };
  const targetDocument = {
    name: "中文 文档.psd",
    layers: [existingLayer, group],
    activeLayer: existingLayer
  };
  let sourceClosed = false;
  const sourceLayer = {
    name: "Background",
    typename: "ArtLayer",
    duplicate(target) {
      const copy = { name: this.name, typename: "ArtLayer" };
      target.layers.unshift(copy);
      target.activeLayer = copy;
      return copy;
    }
  };
  const sourceDocument = {
    layers: [sourceLayer],
    activeLayer: sourceLayer,
    close(saveOption) {
      assert.equal(saveOption, "DONOTSAVECHANGES");
      sourceClosed = true;
    }
  };
  const pngHeader = String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10);
  function ValidFile(filePath) {
    return {
      exists: true,
      name: "mock-result.png",
      fsName: filePath,
      encoding: "UTF-8",
      open() { return true; },
      read() { return pngHeader; },
      close() {}
    };
  }
  const app = {
    documents: [targetDocument],
    activeDocument: targetDocument,
    open() {
      this.activeDocument = sourceDocument;
      return sourceDocument;
    }
  };
  const host = loadHost({
    app,
    File: ValidFile,
    ElementPlacement: { PLACEATBEGINNING: "PLACEATBEGINNING" },
    SaveOptions: { DONOTSAVECHANGES: "DONOTSAVECHANGES" }
  });

  const response = JSON.parse(host.PSAIImageHubCompatHost.importImage('C:\\用户 图片\\A "测试"\\mock-result.png'));
  assert.equal(response.ok, true);
  assert.equal(response.data.imported, true);
  assert.equal(response.data.layerName, "AI_Generated_005");
  assert.equal(response.data.layerType, "ArtLayer");
  assert.equal(targetDocument.layers.length, 3);
  assert.equal(targetDocument.layers[0].name, "AI_Generated_005");
  assert.equal(existingLayer.name, "Background");
  assert.equal(nestedLayer.name, "AI_Generated_004");
  assert.equal(app.activeDocument, targetDocument);
  assert.equal(sourceClosed, true);
});
