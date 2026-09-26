"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "CSXS/manifest.xml",
  "client/index.html",
  "client/css/main.css",
  "client/lib/CSInterface.js",
  "client/assets/mock-result.png",
  "client/js/app.js",
  "client/js/compat/featureDetection.js",
  "client/js/compat/hostCompatibility.js",
  "client/js/compat/cepCompatibility.js",
  "client/js/compat/compatibilityMatrix.js",
  "client/js/compat/compatNetwork.js",
  "client/js/compat/compatStorage.js",
  "client/js/compat/compatFileDialog.js",
  "client/js/providers/baseProvider.js",
  "client/js/providers/modelCatalog.js",
  "client/js/providers/grsModelCatalog.js",
  "client/js/providers/providerRegistry.js",
  "client/js/providers/mockProvider.js",
  "client/js/providers/providerConfig.js",
  "client/js/providers/openAICompatibleProvider.js",
  "client/js/providers/genericRestProvider.js",
  "client/js/providers/asyncTaskProvider.js",
  "client/js/providers/asyncTaskDefinition.js",
  "client/js/providers/asyncTaskDefinitions.js",
  "client/js/providers/aliyunBailianCatalog.js",
  "client/js/providers/aliyunBailianRequestBuilder.js",
  "client/js/providers/aliyunBailianDefinition.js",
  "client/js/providers/aliyunBailianProvider.js",
  "client/js/providers/grsProvider.js",
  "client/js/providers/grsAccountClient.js",
  "client/js/providers/grsLegacyAdapter.js",
  "client/js/providers/providerFactory.js",
  "client/js/storage/imageFileStore.js",
  "client/js/storage/historyStore.js",
  "client/js/storage/grsTaskStore.js",
  "client/js/storage/asyncTaskStore.js",
  "client/js/storage/uiStateStore.js",
  "client/js/storage/generationRecoveryStore.js",
  "client/js/storage/storageManager.js",
  "client/js/storage/persistentSecretStore.js",
  "client/js/presets/promptPresetNormalizer.js",
  "client/js/presets/promptPresetParser.js",
  "client/js/presets/promptPresetCompiler.js",
  "client/js/presets/promptPresetStore.js",
  "client/js/presets/promptPresetRegistry.js",
  "client/js/presets/promptPresetStack.js",
  "client/js/presets/promptPresetPack.js",
  "client/js/generation/cancellationToken.js",
  "client/js/generation/imageInputSet.js",
  "client/js/generation/imagePayloadOptimizer.js",
  "client/js/generation/aspectRatioResolver.js",
  "client/js/generation/pollingManager.js",
  "client/js/generation/generationManager.js",
  "client/js/generation/imageNormalizer.js",
  "client/js/photoshop/bridge.js",
  "client/js/photoshop/bridgeSerialization.js",
  "client/js/photoshop/imageImporter.js",
  "client/js/photoshop/referenceImageManager.js",
  "client/js/photoshop/importSizingManager.js",
  "client/js/i18n/zh-CN.js",
  "client/js/utils/clipboard.js",
  "client/js/ui/modelSelector.js",
  "client/js/ui/darkSelect.js",
  "client/js/ui/mainPanel.js",
  "client/js/ui/historyPanel.js",
  "client/js/ui/promptPresetPanel.js",
  "host/host.jsx",
  "README-CEP.md",
  "CEP-COMPATIBILITY.md",
  "enable-cep-debug.reg.example"
];

let failed = false;

function fail(message) {
  failed = true;
  console.error("FAIL: " + message);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.name === "node_modules") return [];
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

requiredFiles.forEach((file) => {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) fail("Missing required CEP file: " + file);
  else if (fs.statSync(absolute).size === 0) fail("CEP file is empty: " + file);
});

const manifestPath = path.join(root, "CSXS", "manifest.xml");
const manifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
const manifestChecks = [
  [/^<\?xml[^>]+\?>[\s\S]*<ExtensionManifest\b/, "manifest.xml needs an XML declaration and ExtensionManifest root."],
  [/ExtensionBundleId="com\.psai\.imagehub\.compat\.cep11"/, "Unexpected CEP11 Compat bundle ID."],
  [/<Host Name="PHSP" Version="\[23\.0,26\.0\)"\s*\/>/, "CEP Host range must be [23.0,26.0)."],
  [/<RequiredRuntime Name="CSXS" Version="11\.0"\s*\/>/, "CEP runtime must remain in the CSXS 11.x family."],
  [/<MainPath>\.\/client\/index\.html<\/MainPath>/, "CEP MainPath is invalid."],
  [/<ScriptPath>\.\/host\/host\.jsx<\/ScriptPath>/, "CEP ScriptPath is invalid."],
  [/<Type>Panel<\/Type>/, "CEP extension must be a Panel."]
];
manifestChecks.forEach(([pattern, message]) => { if (!pattern.test(manifest)) fail(message); });
if (/--enable-nodejs|--mixed-context|--ignore-certificate-errors/.test(manifest)) {
  fail("CEP manifest must not enable Node.js, mixed context, or invalid-certificate bypasses in this phase.");
}

const allFiles = walk(root);
const javascriptFiles = allFiles.filter((file) => file.endsWith(".js") || file.endsWith(".jsx"));
const localRequirePattern = /require\(["'](\.[^"']+)["']\)/g;

javascriptFiles.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  const syntax = file.endsWith(".jsx")
    ? spawnSync(process.execPath, ["--check", "-"], { encoding: "utf8", input: source })
    : spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (syntax.status !== 0) fail("JavaScript syntax error in " + relative(file) + ":\n" + syntax.stderr);
  const isRuntimeSource = file.startsWith(path.join(root, "client")) || file.startsWith(path.join(root, "host"));
  if (isRuntimeSource && /\beval\s*\(/.test(source)) fail("Forbidden eval() found in " + relative(file) + ".");
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})\b/.test(source)) {
    fail("Possible real API credential found in " + relative(file) + ".");
  }
  let match;
  while ((match = localRequirePattern.exec(source)) !== null) {
    const base = path.resolve(path.dirname(file), match[1]);
    const candidates = [base, base + ".js", path.join(base, "index.js")];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      fail("Unresolved local require '" + match[1] + "' in " + relative(file) + ".");
    }
  }
});

const pngPath = path.join(root, "client", "assets", "mock-result.png");
if (fs.existsSync(pngPath)) {
  const signature = fs.readFileSync(pngPath).subarray(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(expected)) fail("Mock import fixture is not a valid PNG signature.");
}

const hostPath = path.join(root, "host", "host.jsx");
if (fs.existsSync(hostPath)) {
  const hostSource = fs.readFileSync(hostPath, "utf8");
  if (/NOT_IMPLEMENTED[\s\S]{0,160}Image import is reserved/.test(hostSource)) {
    fail("CEP host importImage() is still the pre-Phase-6 placeholder.");
  }
  const ordinaryImportStart = hostSource.indexOf("api.importImage = function importImage");
  const smartObjectImportStart = hostSource.indexOf("api.importSmartObjectToBounds = function importSmartObjectToBounds");
  const ordinaryImportSource = ordinaryImportStart >= 0
    ? hostSource.slice(ordinaryImportStart, smartObjectImportStart >= 0 ? smartObjectImportStart : hostSource.length)
    : "";
  if (/\bexecuteAction\s*\(/.test(ordinaryImportSource)) {
    fail("The ordinary importImage() path must remain Photoshop DOM-only and must not use Action Manager.");
  }
  const executeActionCalls = hostSource.match(/\bexecuteAction\s*\(/g) || [];
  if (executeActionCalls.length > 1 || (executeActionCalls.length === 1 && smartObjectImportStart < 0)) {
    fail("Action Manager is allowed only for the fixed importSmartObjectToBounds() Smart Object conversion path.");
  }
}

const htmlPath = path.join(root, "client", "index.html");
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const referencePattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = referencePattern.exec(html)) !== null) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(match[1])) continue;
    const target = path.resolve(path.dirname(htmlPath), match[1]);
    if (!fs.existsSync(target)) fail("Missing client asset referenced by index.html: " + match[1]);
  }
}

const runtimeRoots = ["CSXS", "client", "host"];
const runtimeFiles = runtimeRoots.flatMap((directory) => walk(path.join(root, directory)));
const removedPromptRuntime = runtimeFiles.filter((file) => {
  const name = relative(file);
  return name.startsWith("client/js/prompt/") || name.startsWith("client/js/text/") || name === "client/js/storage/promptOptimizerStore.js";
});
if (removedPromptRuntime.length) fail("Removed Prompt Optimizer runtime files remain: " + removedPromptRuntime.map(relative).join(", "));
const runtimeBytes = runtimeFiles.reduce((total, file) => total + fs.statSync(file).size, 0);

if (!failed) {
  console.log(
    "PASS: validated CEP manifest, " + requiredFiles.length + " required files, " +
    javascriptFiles.length + " JavaScript/ExtendScript files, and all local references."
  );
  console.log("CEP runtime payload: " + runtimeFiles.length + " files, " + (runtimeBytes / 1024).toFixed(2) + " KiB.");
} else {
  process.exitCode = 1;
}
