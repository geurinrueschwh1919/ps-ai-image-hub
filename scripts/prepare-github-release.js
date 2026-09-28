"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const sourceZip = path.join(projectRoot, "distribution", "dist", "PSAIHub-Compat.zip");
const sourceSetup = path.join(projectRoot, "distribution", "dist", "PSAIHub-Setup.exe");
const sourceDebug = path.join(projectRoot, "distribution", "dist", "PSAIHub-Debug.exe");
const releaseRoot = path.join(projectRoot, "github-release");
const releaseZip = path.join(releaseRoot, "PSAIHub-Compat.zip");
const releaseSetup = path.join(releaseRoot, "PSAIHub-Setup.exe");
const releaseDebug = path.join(releaseRoot, "PSAIHub-Debug.exe");
const hashFile = path.join(releaseRoot, "PSAIHub-Compat.sha256.txt");
const bodyFile = path.join(releaseRoot, "RELEASE_BODY.md");
const bodyTemplate = path.join(projectRoot, "distribution", "templates", "RELEASE_BODY.template.md");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(sourceZip) || fs.statSync(sourceZip).size === 0) {
  throw new Error("Build distribution/dist/PSAIHub-Compat.zip before preparing GitHub Release staging.");
}
for (const file of [sourceSetup, sourceDebug]) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error("Release installer is missing: " + file);
}
if (path.dirname(releaseRoot) !== projectRoot || path.basename(releaseRoot) !== "github-release") {
  throw new Error("Unsafe GitHub Release staging path.");
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });
fs.copyFileSync(sourceZip, releaseZip);
fs.copyFileSync(sourceSetup, releaseSetup);
fs.copyFileSync(sourceDebug, releaseDebug);
const hash = sha256(releaseZip);
fs.writeFileSync(hashFile, hash + "  PSAIHub-Compat.zip\n", "utf8");
const body = fs.readFileSync(bodyTemplate, "utf8").replace(/\{\{ZIP_SHA256\}\}/g, hash);
fs.writeFileSync(bodyFile, body, "utf8");

const files = fs.readdirSync(releaseRoot).sort();
const expected = ["PSAIHub-Setup.exe", "PSAIHub-Debug.exe", "PSAIHub-Compat.sha256.txt", "PSAIHub-Compat.zip", "RELEASE_BODY.md"].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error("Unexpected GitHub Release staging layout: " + files.join(", "));
console.log(JSON.stringify({ releaseRoot, files, zipBytes: fs.statSync(releaseZip).size, zipSha256: hash }, null, 2));
