"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const cepRoot = path.resolve(__dirname, "..");
const manifest = fs.readFileSync(path.join(cepRoot, "CSXS", "manifest.xml"), "utf8");

test("CEP11 Compat manifest targets Photoshop host 23.x through 25.x", () => {
  assert.match(manifest, /<Host Name="PHSP" Version="\[23\.0,26\.0\)"\s*\/>/);
  assert.match(manifest, /<Host Name="PHXS" Version="\[23\.0,26\.0\)"\s*\/>/);
  assert.match(manifest, /<RequiredRuntime Name="CSXS" Version="11\.0"\s*\/>/);
});

test("CEP manifest IDs, paths, and Panel type are internally consistent", () => {
  assert.match(manifest, /ExtensionBundleId="com\.psai\.imagehub\.compat\.cep11"/);
  assert.equal((manifest.match(/Id="com\.psai\.imagehub\.compat\.cep11\.panel"/g) || []).length, 2);
  assert.match(manifest, /<Menu>PS AI Image Hub<\/Menu>/);
  assert.match(manifest, /<MainPath>\.\/client\/index\.html<\/MainPath>/);
  assert.match(manifest, /<ScriptPath>\.\/host\/host\.jsx<\/ScriptPath>/);
  assert.match(manifest, /<Type>Panel<\/Type>/);
});

test("CEP manifest deliberately leaves Node.js disabled", () => {
  assert.doesNotMatch(manifest, /--enable-nodejs|--mixed-context/);
});
