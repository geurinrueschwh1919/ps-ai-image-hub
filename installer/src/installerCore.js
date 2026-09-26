"use strict";

const path = require("node:path");

const EXPECTED = Object.freeze({
  bundleId: "com.psai.imagehub.compat.cep11",
  extensionId: "com.psai.imagehub.compat.cep11.panel",
  displayName: "PS AI Image Hub",
  hostRange: "[23.0,26.0)",
  installFolder: "PS-AI-Image-Hub-CEP11-Compat",
  formalFolder: "PS-AI-Image-Hub-CEP"
});

function parseVersion(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return { text: text || "unknown", major: null, parts: [] };
  return { text, major: Number(match[1]), parts: match.slice(1).filter((item) => item !== undefined).map(Number) };
}

function classifyPhotoshopVersion(value) {
  const parsed = parseVersion(value);
  return { version: parsed.text, major: parsed.major, supported: [23, 24, 25].includes(parsed.major),
    status: [23, 24, 25].includes(parsed.major) ? "Supported" : "Not Targeted",
    marketingYear: parsed.major === 23 ? 2022 : parsed.major === 24 ? 2023 : parsed.major === 25 ? 2024 : parsed.major === 26 ? 2025 : null };
}

function dedupePhotoshop(records) {
  const seen = new Set();
  return (records || []).filter((record) => record && record.exePath).map((record) => {
    const classification = classifyPhotoshopVersion(record.version);
    return Object.assign({}, record, classification);
  }).filter((record) => { const key = String(record.exePath).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => (a.major || 0) - (b.major || 0));
}

function detectPhotoshop(registryDetector, filesystemDetector) {
  const registry = registryDetector && registryDetector.scan ? registryDetector.scan() : [];
  const filesystem = filesystemDetector && filesystemDetector.scan ? filesystemDetector.scan() : [];
  return dedupePhotoshop([].concat(registry || [], filesystem || []));
}

function parseManifest(xml) {
  const text = String(xml || "");
  function one(pattern) { const match = text.match(pattern); return match ? match[1] : null; }
  return {
    bundleId: one(/ExtensionBundleId="([^"]+)"/),
    bundleVersion: one(/ExtensionBundleVersion="([^"]+)"/),
    displayName: one(/ExtensionBundleName="([^"]+)"/),
    extensionId: one(/<Extension\s+Id="([^"]+)"/),
    extensionVersion: one(/<Extension\s+Id="[^"]+"\s+Version="([^"]+)"/),
    hostRange: one(/<Host\s+Name="PHSP"\s+Version="([^"]+)"/)
  };
}

function validateManifest(metadata) {
  const errors = [];
  for (const key of ["bundleId", "extensionId", "displayName", "hostRange"]) if (metadata[key] !== EXPECTED[key]) errors.push(key);
  return { valid: errors.length === 0, errors };
}

function installPaths(appData) {
  const extensionRoot = path.win32.join(String(appData), "Adobe", "CEP", "extensions");
  return { extensionRoot, compat: path.win32.join(extensionRoot, EXPECTED.installFolder), formal: path.win32.join(extensionRoot, EXPECTED.formalFolder),
    data: path.win32.join(String(appData), "Adobe", "PSAIImageHubCompat") };
}

function installationState(fsAdapter, paths, packagedVersion) {
  const installed = fsAdapter.exists(paths.compat);
  const formalInstalled = fsAdapter.exists(paths.formal);
  const installedVersion = installed && fsAdapter.readManifestVersion ? fsAdapter.readManifestVersion(paths.compat) : null;
  return { installed, formalInstalled, installedVersion,
    action: !installed ? "Install" : installedVersion === packagedVersion ? "Repair" : "Update" };
}

function transactionalInstall(adapter, payloadRoot, targetRoot, expectedHashes, backupRoot) {
  const stageRoot = targetRoot + ".installing";
  const existed = adapter.exists(targetRoot);
  adapter.removeTree(stageRoot);
  if (existed) { adapter.removeTree(backupRoot); adapter.copyTree(targetRoot, backupRoot); }
  try {
    adapter.copyTree(payloadRoot, stageRoot);
    if (!adapter.verifyHashes(stageRoot, expectedHashes)) throw new Error("HASH_VALIDATION_FAILED");
    adapter.removeTree(targetRoot);
    adapter.moveTree(stageRoot, targetRoot);
    if (!adapter.verifyHashes(targetRoot, expectedHashes)) throw new Error("POST_INSTALL_HASH_VALIDATION_FAILED");
    adapter.removeTree(backupRoot);
    return { ok: true, action: existed ? "update-or-repair" : "install", rolledBack: false };
  } catch (error) {
    adapter.removeTree(stageRoot); adapter.removeTree(targetRoot);
    if (existed && adapter.exists(backupRoot)) adapter.moveTree(backupRoot, targetRoot);
    return { ok: false, error: error.message, rolledBack: existed };
  }
}

function uninstall(adapter, paths, options) {
  adapter.removeTree(paths.compat);
  if (options && options.removeData === true) adapter.removeTree(paths.data);
  return { formalPreserved: adapter.exists(paths.formal), dataPreserved: !(options && options.removeData === true) };
}

function sanitizeLog(value) {
  const forbidden = /api[-_]?key|authorization|secret|credential|token|bearer|prompt|base64|image|history/i;
  if (Array.isArray(value)) return value.map(sanitizeLog);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  return Object.keys(value).reduce((result, key) => { result[key] = forbidden.test(key) ? "[REDACTED]" : sanitizeLog(value[key]); return result; }, {});
}

function photoshopWarning(records) {
  if ((records || []).some((record) => record.supported)) return null;
  return "未检测到 Photoshop 23.x–25.x。仍可安装扩展，但当前 Photoshop 不属于支持范围。";
}

function normalizeWinPath(value) { return path.win32.normalize(String(value || "")).replace(/[\\/]+$/, "").toLowerCase(); }

function createCepRoots(paths, adapter, isAdmin) {
  const definitions = [
    { type: "system-x86", path: paths.systemX86, requiresAdmin: true },
    { type: "system-x64", path: paths.systemX64, requiresAdmin: true },
    { type: "user", path: paths.user, requiresAdmin: false }
  ];
  return definitions.map((root) => Object.assign({}, root, { exists: adapter.exists(root.path), writable: root.requiresAdmin ? Boolean(isAdmin) : true }));
}

function detectCepInstallations(roots, adapter) {
  const formalLocations = [], compatLocations = [];
  for (const root of roots) {
    const formalPath = path.win32.join(root.path, EXPECTED.formalFolder);
    const compatPath = path.win32.join(root.path, EXPECTED.installFolder);
    if (adapter.exists(formalPath)) formalLocations.push({ root, rootPath: root.path, path: formalPath, version: adapter.readManifestVersion ? adapter.readManifestVersion(formalPath) : null });
    if (adapter.exists(compatPath)) {
      const manifest = adapter.readManifest ? adapter.readManifest(compatPath) : { bundleId: EXPECTED.bundleId, extensionId: EXPECTED.extensionId };
      compatLocations.push({ root, rootPath: root.path, path: compatPath, version: adapter.readManifestVersion ? adapter.readManifestVersion(compatPath) : null,
        identityValid: manifest.bundleId === EXPECTED.bundleId && manifest.extensionId === EXPECTED.extensionId });
    }
  }
  return { formalInstalled: formalLocations.length > 0, formalLocations, compatInstalled: compatLocations.length > 0, compatLocations, duplicateCompat: compatLocations.length > 1 };
}

function selectRecommendedCepRoot(roots, state) {
  if (state.formalLocations.length === 1) return { root: state.formalLocations[0].root, source: "formal" };
  if (state.formalLocations.length === 0 && state.compatLocations.length === 1) return { root: state.compatLocations[0].root, source: "compat" };
  if (state.formalLocations.length) {
    const same = state.formalLocations.find((formal) => state.compatLocations.some((compat) => normalizeWinPath(compat.rootPath) === normalizeWinPath(formal.rootPath)));
    return { root: (same || state.formalLocations[0]).root, source: same ? "formal-and-compat" : "formal-multiple" };
  }
  if (state.compatLocations.length) return { root: state.compatLocations[0].root, source: "compat-multiple" };
  for (const type of ["user", "system-x86", "system-x64"]) { const root = roots.find((item) => item.type === type && item.exists && item.writable); if (root) return { root, source: "existing-writable" }; }
  for (const type of ["system-x86", "system-x64"]) { const root = roots.find((item) => item.type === type && item.exists); if (root) return { root, source: "existing-system" }; }
  return { root: roots.find((item) => item.type === "user"), source: "create-selected-only" };
}

function selectPrimaryCompat(state, recommendation, persisted) {
  if (persisted && persisted.installPath) { const found = state.compatLocations.find((item) => normalizeWinPath(item.path) === normalizeWinPath(persisted.installPath)); if (found) return found; }
  if (state.compatLocations.length === 1) return state.compatLocations[0];
  const recommended = recommendation && recommendation.root && state.compatLocations.find((item) => normalizeWinPath(item.rootPath) === normalizeWinPath(recommendation.root.path));
  return recommended || state.compatLocations[0] || null;
}

function adminInstallDecision(root, isAdmin, userApprovedElevation) {
  if (!root.requiresAdmin || isAdmin) return { allowed: true, elevationRequired: false, denied: false };
  if (userApprovedElevation === true) return { allowed: false, elevationRequired: true, denied: false };
  return { allowed: false, elevationRequired: false, denied: true };
}

function validateCompatDeleteTarget(targetPath, roots, manifest) {
  const leaf = path.win32.basename(targetPath);
  const parent = path.win32.dirname(targetPath);
  const known = roots.some((root) => normalizeWinPath(root.path) === normalizeWinPath(parent));
  return leaf === EXPECTED.installFolder && known && manifest.bundleId === EXPECTED.bundleId && manifest.extensionId === EXPECTED.extensionId;
}

function persistInstallLocation(registry, root, installPath, version) { registry.set("InstallRoot", root); registry.set("InstallPath", installPath); registry.set("InstalledVersion", version); }
function resolvePersistedInstallLocation(registry) { return { installRoot: registry.get("InstallRoot"), installPath: registry.get("InstallPath"), installedVersion: registry.get("InstalledVersion") }; }
function resolveUninstallLocation(state, persisted) { return selectPrimaryCompat(state, null, persisted); }
function resolveOpenLocation(primaryCompat, selectedRoot) { return primaryCompat ? primaryCompat.path : selectedRoot.path; }

module.exports = { EXPECTED, parseVersion, classifyPhotoshopVersion, dedupePhotoshop, detectPhotoshop, parseManifest,
  validateManifest, installPaths, installationState, transactionalInstall, uninstall, sanitizeLog, photoshopWarning,
  createCepRoots, detectCepInstallations, selectRecommendedCepRoot, selectPrimaryCompat, adminInstallDecision,
  validateCompatDeleteTarget, persistInstallLocation, resolvePersistedInstallLocation, resolveUninstallLocation, resolveOpenLocation };
