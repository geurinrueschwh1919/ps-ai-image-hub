"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "source", "PS-AI-Image-Hub-CEP11-Compat");
const stagingRoot = path.join(projectRoot, "outputs", "dev", "PS-AI-Image-Hub-CEP11-Compat");
const failures = [];
const observations = [];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute)); else if (entry.isFile()) files.push(absolute);
  }
  return files;
}
function relative(file) { return path.relative(sourceRoot, file).split(path.sep).join("/"); }
function fail(message) { failures.push(message); }

const runtimeFiles = ["CSXS", "client", "host"].flatMap((name) => walk(path.join(sourceRoot, name)));
const jsFiles = runtimeFiles.filter((file) => /\.(?:js|jsx)$/.test(file));
const risky = [
  [/\?\./, "optional chaining"], [/\?\?/, "nullish coalescing"], [/\?\?=|&&=|\|\|=/, "logical assignment"],
  [/Object\.fromEntries/, "Object.fromEntries"], [/\.flat(?:Map)?\s*\(/, "Array.flat/flatMap"], [/Promise\.allSettled/, "Promise.allSettled"],
  [/\bstructuredClone\b/, "structuredClone"], [/crypto\.randomUUID/, "crypto.randomUUID"], [/\.replaceAll\s*\(/, "String.replaceAll"],
  [/\bBigInt\s*\(/, "BigInt"], [/\bimport\s*\(/, "dynamic import"], [/catch\s*\{/, "optional catch binding"]
];
for (const file of jsFiles.filter((file) => file.includes(path.sep + "client" + path.sep))) {
  const source = fs.readFileSync(file, "utf8");
  for (const [pattern, name] of risky) if (pattern.test(source)) fail("JS compatibility: " + name + " in " + relative(file));
}
const hostSource = fs.readFileSync(path.join(sourceRoot, "host", "host.jsx"), "utf8");
if (/\b(?:let|const|class|async|await)\b|=>|\?\.|\?\?/.test(hostSource)) fail("ExtendScript contains unsupported modern syntax.");

const css = fs.readFileSync(path.join(sourceRoot, "client", "css", "main.css"), "utf8");
for (const feature of ["display: grid", "gap:", "var("]) if (css.includes(feature)) observations.push("CSS uses " + feature.trim() + " with explicit legacy fallback rules.");
if (!/@supports not \(gap: 1px\)/.test(css) || !/@supports not \(display: grid\)/.test(css)) fail("CSS compatibility fallbacks are missing.");

const manifest = fs.readFileSync(path.join(sourceRoot, "CSXS", "manifest.xml"), "utf8");
if (!/ExtensionBundleId="com\.psai\.imagehub\.compat\.cep11"/.test(manifest)) fail("Compat Bundle ID is missing.");
if ((manifest.match(/Id="com\.psai\.imagehub\.compat\.cep11\.panel"/g) || []).length !== 2) fail("Compat Extension ID is inconsistent.");
if (!/<Host Name="PHSP" Version="\[23\.0,26\.0\)"\s*\/>/.test(manifest)) fail("Manifest host range is not [23.0,26.0).");

const runtimeText = jsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
if (/root\.PSAIHub\b|\bPSAIImageHubHost\b/.test(runtimeText)) fail("Formal JavaScript namespace remains in Compat runtime.");
if (/ps-ai-image-hub\.cep(?:[.:"'])/.test(runtimeText)) fail("Formal storage namespace remains in Compat runtime.");
if (/(["'])PSAIImageHub\1/.test(runtimeText)) fail("Formal USER_DATA directory remains in Compat runtime.");
if (!/PSAIImageHubCompat/.test(runtimeText) || !/ps-ai-image-hub\.compat\.cep11/.test(runtimeText)) fail("Compat namespaces are missing.");

const indexPath = path.join(sourceRoot, "client", "index.html");
const html = fs.readFileSync(indexPath, "utf8");
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  if (!/^(?:[a-z]+:|#|\/\/)/i.test(match[1]) && !fs.existsSync(path.resolve(path.dirname(indexPath), match[1]))) fail("Missing runtime resource: " + match[1]);
}
const forbidden = new Set(["tests", "scripts", "reports", "fixtures", "node_modules", "backup", "logs", "temp", "screenshots"]);
for (const file of walk(stagingRoot)) {
  const parts = path.relative(stagingRoot, file).split(path.sep).map((part) => part.toLowerCase());
  if (parts.some((part) => forbidden.has(part))) fail("Forbidden staging path: " + path.relative(stagingRoot, file));
}

const lines = ["# Static Compatibility Scan", "", "- Time: `" + new Date().toISOString() + "`",
  "- Runtime files scanned: `" + runtimeFiles.length + "`", "- JavaScript/ExtendScript files scanned: `" + jsFiles.length + "`",
  "- Result: **" + (failures.length ? "FAIL" : "PASS") + "**", "", "## Observations", "",
  ...observations.map((item) => "- " + item), "", "## Failures", "", ...(failures.length ? failures.map((item) => "- " + item) : ["- None."]), ""];
fs.writeFileSync(path.join(projectRoot, "reports", "STATIC_SCAN_REPORT.md"), lines.join("\n"), "utf8");
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("PASS: static compatibility, identity, resource, namespace, and staging scans.");
