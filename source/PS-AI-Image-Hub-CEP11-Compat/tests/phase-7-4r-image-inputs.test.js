"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createImageInputSet, orderedImageInputs, moveReferenceImage, MAX_REFERENCE_IMAGES } = require("../client/js/generation/imageInputSet");
const { buildGenerationRequest } = require("../client/js/generation/requestBuilder");
const { buildGrsHttpRequest, normalizeGrsConfig } = require("../client/js/providers/grsProvider");
const { getGrsModel } = require("../client/js/providers/grsModelCatalog");

function image(id) { return { id, base64: "BASE64-" + id, sourceType: "local-file", sourceLabel: "local-file", mimeType: "image/png", fileName: id + ".png", width: 10, height: 20, localPath: "C:\\" + id + ".png" }; }

test("ImageInputSet keeps at most one main image and eight ordered references", () => {
  const main = image("main");
  const references = Array.from({ length: 12 }, (_, index) => image("r" + index));
  const set = createImageInputSet({ mainImage: main, referenceImages: references });
  assert.equal(set.mainImage, main);
  assert.equal(set.referenceImages.length, MAX_REFERENCE_IMAGES);
  assert.deepEqual(orderedImageInputs(set).map((item) => item.id), ["main", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
});

test("Reference ordering supports lightweight up/down movement", () => {
  assert.deepEqual(moveReferenceImage([image("a"), image("b"), image("c")], 2, 1).map((item) => item.id), ["a", "c", "b"]);
});

test("Generation request preserves provider-neutral mainImage and referenceImages", () => {
  const request = buildGenerationRequest({ providerId: "grs", modelId: "nano-banana-2", prompt: "p", imageInputs: { mainImage: image("main"), referenceImages: [image("r1")] } });
  assert.equal(request.mainImage.id, "main");
  assert.deepEqual(request.referenceImages.map((item) => item.id), ["r1"]);
  assert.deepEqual(request.references.map((item) => item.id), ["main", "r1"]);
});

test("GRS New API maps main image first followed by ordered references to images[]", () => {
  const request = buildGenerationRequest({ providerId: "grs", modelId: "nano-banana-2", prompt: "p", aspectRatio: "auto", imageSize: "1K", imageInputs: { mainImage: image("main"), referenceImages: [image("r1"), image("r2")] } });
  const http = buildGrsHttpRequest(request, normalizeGrsConfig(), "test-key", getGrsModel("nano-banana-2"));
  assert.deepEqual(JSON.parse(http.body).images, ["BASE64-main", "BASE64-r1", "BASE64-r2"]);
  assert.equal(JSON.stringify(http.body).includes("C:\\"), false);
});

test("Text-only GRS New API sends images[] empty", () => {
  const request = buildGenerationRequest({ providerId: "grs", modelId: "gpt-image-2", prompt: "p", aspectRatio: "1:1", imageInputs: createImageInputSet() });
  const http = buildGrsHttpRequest(request, normalizeGrsConfig(), "test-key", getGrsModel("gpt-image-2"));
  assert.deepEqual(JSON.parse(http.body).images, []);
});
