"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const serialization = require("../client/js/photoshop/bridgeSerialization");
const compatibility = require("../client/js/compat/hostCompatibility");

const cepRoot = path.resolve(__dirname, "..");
const clientRoot = path.join(cepRoot, "client", "js");
const hostPath = path.join(cepRoot, "host", "host.jsx");
const hostSource = fs.readFileSync(hostPath, "utf8");

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

function loadHost(overrides) {
  const context = Object.assign({ isFinite, parseInt, Error }, overrides || {});
  vm.createContext(context);
  vm.runInContext(hostSource, context, { filename: "host.jsx" });
  return context.PSAIImageHubCompatHost;
}

function clientInvokedMethods() {
  const methods = new Set();
  for (const file of walk(clientRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\.invoke\(\s*["']([A-Za-z][A-Za-z0-9_]*)["']/g)) methods.add(match[1]);
  }
  return [...methods].sort();
}

function hostImplementedMethods() {
  return [...hostSource.matchAll(/api\.([A-Za-z][A-Za-z0-9_]*)\s*=\s*function/g)]
    .map((match) => match[1]).filter((name) => name.charAt(0) !== "_").sort();
}

test("getHostCapabilities is explicitly allowed with zero arguments", () => {
  assert.equal(serialization.ALLOWED_HOST_METHODS.getHostCapabilities, 0);
  assert.equal(serialization.buildHostCall("getHostCapabilities"), "PSAIImageHubCompatHost.getHostCapabilities()");
});

test("unknown host methods remain rejected", () => {
  assert.throws(() => serialization.buildHostCall("notImplemented"), /method is not allowed/);
});

test("arbitrary and malicious host method text remains rejected", () => {
  for (const value of ["constructor", "__proto__", "ping();app.quit", "getHostCapabilities\napp.quit()"])
    assert.throws(() => serialization.buildHostCall(value), /method is not allowed/);
});

test("getHostCapabilities call and response serialize through the strict bridge contract", () => {
  const script = serialization.buildHostCall("getHostCapabilities", []);
  assert.equal(script, "PSAIImageHubCompatHost.getHostCapabilities()");
  const value = serialization.parseBridgeResponse(JSON.stringify({ ok: true, data: { documentAccess: true, fileOpen: false }, error: null }));
  assert.deepEqual(value, { documentAccess: true, fileOpen: false });
});

test("host getHostCapabilities returns a JSON-safe object containing booleans only", () => {
  const host = loadHost({ app: { documents: [] }, File: function File() {}, PNGSaveOptions: function PNGSaveOptions() {}, ElementPlacement: {} });
  const response = JSON.parse(host.getHostCapabilities());
  assert.equal(response.ok, true);
  assert.deepEqual(Object.keys(response.data).sort(), compatibility.HOST_CAPABILITY_NAMES.slice().sort());
  Object.values(response.data).forEach((value) => assert.equal(typeof value, "boolean"));
  assert.doesNotThrow(() => JSON.stringify(response));
});

test("capability probe synchronous throws and asynchronous rejections both use the conservative fallback", async () => {
  const expected = compatibility.emptyHostCapabilities();
  const syncValue = await compatibility.getHostCapabilities({ invoke() { throw new Error("sync unavailable"); } });
  const asyncValue = await compatibility.getHostCapabilities({ invoke() { return Promise.reject(new Error("async unavailable")); } });
  assert.deepEqual(syncValue, expected);
  assert.deepEqual(asyncValue, expected);
});

test("every client bridge invocation is present in the strict allowlist", () => {
  const invoked = clientInvokedMethods();
  const allowed = Object.keys(serialization.ALLOWED_HOST_METHODS).sort();
  assert.deepEqual(invoked, allowed);
});

test("every allowlisted bridge method has a public ExtendScript implementation", () => {
  assert.deepEqual(Object.keys(serialization.ALLOWED_HOST_METHODS).sort(), hostImplementedMethods());
});

for (const major of [23, 24, 25]) test("Photoshop " + major + " fixture keeps its CEP11 compatibility profile", async () => {
  assert.equal(compatibility.compatibilityProfile({ hostName: "PHSP", hostVersion: major + ".0.0", hostMajor: major }), "PS" + major + "_CEP11");
  const detected = await compatibility.getHostCapabilities({ invoke(method) {
    assert.equal(method, "getHostCapabilities");
    return Promise.resolve({ documentAccess: true, currentCanvasExport: major >= 23, currentSelectionExport: true,
      layerImport: true, tempDocumentWorkflow: true, fileOpen: true });
  } });
  assert.equal(detected.documentAccess, true);
  assert.equal(detected.layerImport, true);
});
