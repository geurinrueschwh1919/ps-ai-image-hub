"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const sourceZip = path.join(projectRoot, "distribution", "dist", "PSAIHub-Compat.zip");
const releaseRoot = path.join(projectRoot, "github-release");
const releaseZip = path.join(releaseRoot, "PSAIHub-Compat.zip");
const hashFile = path.join(releaseRoot, "PSAIHub-Compat.sha256.txt");
const bodyFile = path.join(releaseRoot, "RELEASE_BODY.md");
const bodyTemplate = path.join(projectRoot, "distribution", "templates", "RELEASE_BODY.template.md");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(sourceZip) || fs.statSync(sourceZip).size === 0) {
  throw new Error("Build distribution/dist/PSAIHub-Compat.zip before preparing GitHub Release staging.");
}
if (path.dirname(releaseRoot) !== projectRoot || path.basename(releaseRoot) !== "github-release") {
  throw new Error("Unsafe GitHub Release staging path.");
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });
fs.copyFileSync(sourceZip, releaseZip);
const hash = sha256(releaseZip);
fs.writeFileSync(hashFile, hash + "  PSAIHub-Compat.zip\n", "utf8");
const body = fs.readFileSync(bodyTemplate, "utf8").replace(/\{\{ZIP_SHA256\}\}/g, hash);
fs.writeFileSync(bodyFile, body, "utf8");

const files = fs.readdirSync(releaseRoot).sort();
const expected = ["PSAIHub-Compat.sha256.txt", "PSAIHub-Compat.zip", "RELEASE_BODY.md"].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error("Unexpected GitHub Release staging layout: " + files.join(", "));
console.log(JSON.stringify({ releaseRoot, files, zipBytes: fs.statSync(releaseZip).size, zipSha256: hash }, null, 2));
