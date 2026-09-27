"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fflate = require("../source/PS-AI-Image-Hub-CEP11-Compat/client/lib/fflate.min.js");

const root = path.resolve(__dirname, "..");
const releaseRoot = path.join(root, "github-release");
const excludedRoots = [
  ".git", "node_modules", "outputs", "reports", "github-release",
  "installer/build", "installer/dist", "installer/reports",
  "distribution/build", "distribution/dist", "distribution/reports"
];
const textExtensions = new Set([".js", ".jsx", ".json", ".md", ".txt", ".xml", ".html", ".css", ".ps1", ".psm1", ".cmd", ".reg", ".yaml", ".yml"]);
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["Alibaba access key", /\bLTAI[A-Za-z0-9]{12,}\b/],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Bearer token", /Bearer\s+[A-Za-z0-9._~-]{24,}/i]
];
const forbiddenDataNames = /(?:^|\/)(?:\.env(?:\..+)?|sensitive-provider-config\.json|localStorage[^/]*\.json|history\.json|credentials?[^/]*\.json|[^/]+\.(?:log|tmp|bak))$/i;
const personalPatterns = [
  ["absolute Windows user profile", /[A-Za-z]:\\Users\\[^\\\r\n]+/i],
  ["Codex workspace path", /Documents\\Codex\\/i]
];

function rel(file) { return path.relative(root, file).split(path.sep).join("/"); }
function isExcluded(relative) { return excludedRoots.some((base) => relative === base || relative.startsWith(base + "/")); }
function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = rel(absolute);
    if (isExcluded(relative)) continue;
    if (entry.isDirectory()) result.push(...walk(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}
function auditBuffer(name, buffer, failures) {
  const text = buffer.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    if (label === "Bearer token" && /(^|\/)tests?(\/|$)/i.test(name)) continue;
    if (pattern.test(text)) failures.push(label + ": " + name);
  }
  for (const [label, pattern] of personalPatterns) if (pattern.test(text)) failures.push(label + ": " + name);
}

const failures = [];
const sourceFiles = walk(root);
for (const file of sourceFiles) {
  const relative = rel(file);
  if (forbiddenDataNames.test(relative)) failures.push("private/generated filename: " + relative);
  if (textExtensions.has(path.extname(file).toLowerCase())) auditBuffer(relative, fs.readFileSync(file), failures);
}

for (const required of ["README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "FEATURE-PARITY.md", "THIRD-PARTY-NOTICES.md", ".gitignore"]) {
  if (!fs.existsSync(path.join(root, required))) failures.push("missing public source file: " + required);
}
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
if (!/Photoshop 26\.x[\s\S]*不支持/.test(readme)) failures.push("README lacks the Photoshop 26.x unsupported warning");
if (/Experimental|测试版|外部兼容性测试版/i.test(readme)) failures.push("README contains pre-release branding");

let releaseFiles = [];
if (!fs.existsSync(releaseRoot)) failures.push("github-release staging is missing");
else {
  releaseFiles = fs.readdirSync(releaseRoot).sort();
  const expected = ["PSAIHub-Compat.sha256.txt", "PSAIHub-Compat.zip", "RELEASE_BODY.md"].sort();
  if (JSON.stringify(releaseFiles) !== JSON.stringify(expected)) failures.push("unexpected github-release layout");
  for (const name of releaseFiles) {
    const file = path.join(releaseRoot, name);
    if (/\.(?:md|txt)$/i.test(name)) auditBuffer("github-release/" + name, fs.readFileSync(file), failures);
  }
  const zipPath = path.join(releaseRoot, "PSAIHub-Compat.zip");
  if (fs.existsSync(zipPath)) {
    const rawZipEntries = fflate.unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
    const zipEntries = {};
    for (const rawName of Object.keys(rawZipEntries)) zipEntries[rawName.replace(/\\/g, "/")] = rawZipEntries[rawName];
    const names = Object.keys(zipEntries).sort();
    const requiredEntries = [
      "PSAIHub-Compat/PSAIHub-Setup.vbs",
      "PSAIHub-Compat/Debug/PSAIHub-Debug.cmd",
      "PSAIHub-Compat/Installer/install.ps1",
      "PSAIHub-Compat/Manual/PS-AI-Image-Hub-CEP11-Compat/CSXS/manifest.xml",
      "PSAIHub-Compat/README-安装说明.txt"
    ];
    for (const name of requiredEntries) if (!names.includes(name)) failures.push("release ZIP missing: " + name);
    if (names.some((name) => /\.exe$/i.test(name))) failures.push("release ZIP must not distribute unsigned EXE files");
    for (const name of names) {
      if (forbiddenDataNames.test(name) || /(^|\/)(?:node_modules|tests?|logs?|USER_DATA|\.git)(\/|$)/i.test(name)) failures.push("forbidden release ZIP entry: " + name);
      if (/\.(?:md|txt|json|xml|html|css|js|jsx|ps1|psm1|cmd|vbs)$/i.test(name)) auditBuffer("release ZIP:" + name, Buffer.from(zipEntries[name]), failures);
    }
  }
}

if (failures.length) {
  console.error("PUBLIC RELEASE AUDIT FAILED\n" + failures.map((item) => "- " + item).join("\n"));
  process.exitCode = 1;
} else {
  const zipPath = path.join(releaseRoot, "PSAIHub-Compat.zip");
  const zipHash = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  console.log(JSON.stringify({ sourceCandidateFiles: sourceFiles.length, secretFindings: 0, personalPathFindings: 0,
    releaseFiles, releaseZipSha256: zipHash, result: "PASS" }, null, 2));
}
