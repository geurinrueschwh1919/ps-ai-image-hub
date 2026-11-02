"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hostCompatibility = require("../client/js/compat/hostCompatibility");
const featureDetection = require("../client/js/compat/featureDetection");
const compatStorage = require("../client/js/compat/compatStorage");
const persistent = require("../client/js/compat/persistentPanel");
const installerCore = require("../../../installer/src/installerCore");
const { RegistryDetector } = require("../../../installer/src/registryDetector");

const runtimeRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(runtimeRoot, "../..");
const manifest = fs.readFileSync(path.join(runtimeRoot, "CSXS", "manifest.xml"), "utf8");
const hostSource = fs.readFileSync(path.join(runtimeRoot, "host", "host.jsx"), "utf8");
const appSource = fs.readFileSync(path.join(runtimeRoot, "client", "js", "app.js"), "utf8");

function versionParts(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function compareVersion(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return NaN;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function manifestAccepts(value) {
  return compareVersion(value, "23.0") >= 0 && compareVersion(value, "26.0") < 0;
}

function hostInfo(version, hostName = "PHSP") {
  return hostCompatibility.readHostEnvironment({ csInterface: { getHostEnvironment() {
    return { appName: hostName, appVersion: version, osInformation: "Windows fixture" };
  } } });
}

function memoryAdapter(initial) {
  const trees = new Set(initial || []);
  return {
    trees,
    failHashes: false,
    exists(value) { return trees.has(value); },
    removeTree(value) { trees.delete(value); },
    copyTree(from, to) { if (!trees.has(from)) throw new Error("missing fixture"); trees.add(to); },
    moveTree(from, to) { if (!trees.has(from)) throw new Error("missing fixture"); trees.delete(from); trees.add(to); },
    verifyHashes() { return !this.failHashes; },
    readManifestVersion() { return "1.0.2"; }
  };
}

test("compat manifest declares PHSP and PHXS for the complete [23.0,26.0) range", () => {
  assert.match(manifest, /<Host Name="PHSP" Version="\[23\.0,26\.0\)"\s*\/>/);
  assert.match(manifest, /<Host Name="PHXS" Version="\[23\.0,26\.0\)"\s*\/>/);
  assert.match(manifest, /<RequiredRuntime Name="CSXS" Version="11\.0"\s*\/>/);
});

for (const version of ["23.0", "23.5", "24.0", "24.7", "25.0", "25.10", "25.11"]) {
  test(`manifest tuple comparison accepts Photoshop ${version}`, () => assert.equal(manifestAccepts(version), true));
}

test("Photoshop 25.12 is still inside the manifest range but is marked as the CEP 12 boundary", () => {
  assert.equal(manifestAccepts("25.12"), true);
  assert.equal(compareVersion("25.12", "25.11") > 0, true);
});

test("26.0 is excluded by the exclusive upper bound", () => assert.equal(manifestAccepts("26.0"), false));

for (const hostName of ["PHSP", "PHXS"]) {
  for (const [version, profile] of [["23.0", "PS23_CEP11"], ["23.5", "PS23_CEP11"], ["24.0", "PS24_CEP11"],
    ["24.7", "PS24_CEP11"], ["25.0", "PS25_CEP11"], ["25.10", "PS25_CEP11"], ["25.11", "PS25_CEP11"], ["25.12", "PS25_CEP11"]]) {
    test(`${hostName} parser preserves ${version} and selects ${profile}`, () => {
      const info = hostInfo(version, hostName);
      assert.equal(info.hostName, hostName);
      assert.equal(info.hostVersion, version);
      assert.equal(hostCompatibility.compatibilityProfile(info), profile);
    });
  }
}

test("host version parsing does not use parseFloat", () => {
  const source = fs.readFileSync(path.join(runtimeRoot, "client", "js", "compat", "hostCompatibility.js"), "utf8");
  assert.doesNotMatch(source, /parseFloat\s*\(/);
  assert.equal(hostInfo("25.10").hostMajor, 25);
  assert.equal(hostInfo("25.11").hostMajor, 25);
});

test("non-Photoshop hosts remain unsupported while unknown hosts keep the safe fallback", () => {
  assert.equal(hostCompatibility.compatibilityProfile(hostInfo("24.7", "ILST")), "UNSUPPORTED_HOST");
  assert.equal(hostCompatibility.compatibilityProfile({ hostName: "unknown", hostMajor: null }), "UNKNOWN_CEP11");
});

test("missing CEP browser APIs degrade to capability flags and MemoryStore", () => {
  const capabilities = featureDetection.detectCepCapabilities({ JSON, Promise });
  assert.equal(capabilities.hasCSInterface, false);
  assert.equal(capabilities.hasCepFs, false);
  assert.equal(capabilities.hasXHR, false);
  const fallback = compatStorage.createCompatibleStorage(null);
  assert.equal(fallback.persistent, false);
  fallback.storage.setItem("fixture", "safe");
  assert.equal(fallback.storage.getItem("fixture"), "safe");
});

test("Persistent Panel safely skips when CEP event APIs are absent", () => {
  const result = new persistent.PersistentPanelController({ root: {} }).request();
  assert.equal(result.failed, true);
  assert.equal(result.requested, false);
});

test("PS23 and PS24 profiles do not block panel bootstrap or feature initialization", () => {
  assert.doesNotMatch(appSource, /(?:PS23_CEP11|PS24_CEP11)[\s\S]{0,120}(?:throw|return\s+false)/);
  assert.match(appSource, /new hub\.AutoSharpenManager/);
  assert.match(appSource, /new hub\.HistoryStore/);
  assert.match(appSource, /new hub\.GenerationRecoveryStore/);
  assert.match(appSource, /requestPersistentPanel/);
});

test("client runtime avoids APIs newer than Chromium 88 in application source", () => {
  const roots = [path.join(runtimeRoot, "client", "js")];
  const files = [];
  function walk(folder) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full);
  } }
  roots.forEach(walk);
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /\?\.|\?\?|Object\.fromEntries|structuredClone|\.replaceAll\s*\(|\bBigInt\s*\(/);
  assert.doesNotMatch(manifest, /--enable-nodejs|--mixed-context/);
});

test("ExtendScript host remains ES3-style and exposes all audited Photoshop operations", () => {
  assert.doesNotMatch(hostSource, /\b(?:let|const|class)\s|=>|\?\.|\?\?|`/);
  for (const pattern of [/sourceLayer\.duplicate/, /applyHighPass\(safeRadius\)/, /BlendMode\.SOFTLIGHT/,
    /BlendMode\.OVERLAY/, /BlendMode\.LINEARLIGHT/, /sharpenLayer\.opacity = safeOpacity/,
    /sharpenLayer\.desaturate\(\)/, /selection\.feather\(safeFeather\)/,
    /createRevealSelectionMask\(\)/, /app\.open\(fileReference\)/, /newPlacedLayer/]) assert.match(hostSource, pattern);
});

test("Auto Sharpen host guards radius and opacity across the documented ranges", () => {
  assert.match(hostSource, /safeRadius >= 0\.1 && safeRadius <= 10\.0/);
  assert.match(hostSource, /safeOpacity >= 0 && safeOpacity <= 100/);
});

test("evalScript bridge serialization remains allowlisted and JSON encoded", () => {
  const bridge = fs.readFileSync(path.join(runtimeRoot, "client", "js", "photoshop", "bridge.js"), "utf8");
  const serialization = fs.readFileSync(path.join(runtimeRoot, "client", "js", "photoshop", "bridgeSerialization.js"), "utf8");
  assert.match(bridge, /serialization\.buildHostCall/);
  assert.match(serialization, /ALLOWED_HOST_METHODS/);
  assert.match(serialization, /JSON\.parse/);
  assert.doesNotMatch(serialization, /\beval\s*\(/);
});

test("simulated registry detection covers coexisting Photoshop 23 24 and 25 without real registry access", () => {
  const detector = new RegistryDetector({ findPhotoshop() { return ["23.5", "24.7", "25.11"].map((version) => ({
    version, exePath: `C:\\Adobe 测试\\Photoshop ${version}\\Photoshop.exe`
  })); } });
  const detected = installerCore.detectPhotoshop(detector, { scan() { return []; } });
  assert.deepEqual(detected.map((item) => item.major), [23, 24, 25]);
  assert.equal(detected.every((item) => item.supported), true);
});

test("isolated install update repair rollback and uninstall simulation touches only the lab path", () => {
  const root = "C:\\用户 空格\\Adobe\\CEP\\extensions";
  const lab = path.win32.join(root, "PS-AI-Image-Hub-CEP11-Compat");
  const formal = path.win32.join(root, "PS-AI-Image-Hub-CEP");
  const data = "C:\\用户 空格\\AppData\\Roaming\\PSAIImageHubCompat";
  const paths = { compat: lab, formal, data };
  const adapter = memoryAdapter(["payload", formal, data]);
  assert.equal(installerCore.installationState(adapter, paths, "1.0.2").action, "Install");
  assert.equal(installerCore.transactionalInstall(adapter, "payload", lab, {}, lab + ".backup").ok, true);
  assert.equal(adapter.exists(formal), true);
  assert.equal(installerCore.installationState(adapter, paths, "1.0.2").action, "Repair");
  adapter.readManifestVersion = function oldVersion() { return "1.0.1"; };
  assert.equal(installerCore.installationState(adapter, paths, "1.0.2").action, "Update");
  adapter.failHashes = true;
  const rollback = installerCore.transactionalInstall(adapter, "payload", lab, {}, lab + ".backup");
  assert.equal(rollback.rolledBack, true);
  assert.equal(adapter.exists(lab), true);
  adapter.failHashes = false;
  const removed = installerCore.uninstall(adapter, paths, {});
  assert.equal(adapter.exists(lab), false);
  assert.equal(removed.formalPreserved, true);
  assert.equal(adapter.exists(data), true);
});

test("audit confirms the shipped installer identity is Compat, not the PS AI Image Hub identity", () => {
  assert.equal(installerCore.EXPECTED.extensionId, "com.psai.imagehub.compat.cep11.panel");
  assert.notEqual(installerCore.EXPECTED.extensionId, "com.psai.imagehub.autosharpen.lab.cep11.panel");
});
