"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { scanTree } = require("./tree-hash");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "source", "PS-AI-Image-Hub-CEP11-Compat");
const devRoot = path.join(projectRoot, "outputs", "dev");
const stagingRoot = path.join(devRoot, "PS-AI-Image-Hub-CEP11-Compat");
const runtimeDirectories = ["CSXS", "client", "host"];

if (path.dirname(stagingRoot) !== devRoot || path.basename(stagingRoot) !== "PS-AI-Image-Hub-CEP11-Compat") {
  throw new Error("Refusing to build outside the exact dev staging directory.");
}
fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });
for (const name of runtimeDirectories) fs.cpSync(path.join(sourceRoot, name), path.join(stagingRoot, name), { recursive: true });

const forbiddenNames = new Set(["tests", "scripts", "reports", "fixtures", "node_modules", "backup", "logs", "temp", "screenshots"]);
function findForbidden(directory, relative = "") {
  const hits = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relative ? relative + "/" + entry.name : entry.name;
    if (forbiddenNames.has(entry.name.toLowerCase())) hits.push(childRelative);
    if (entry.isDirectory()) hits.push(...findForbidden(path.join(directory, entry.name), childRelative));
  }
  return hits;
}
const forbidden = findForbidden(stagingRoot);
if (forbidden.length) throw new Error("Forbidden staging entries: " + forbidden.join(", "));

const sourceStats = runtimeDirectories.map((name) => scanTree(path.join(sourceRoot, name)));
const stagingStats = scanTree(stagingRoot);
const sourceFileCount = sourceStats.reduce((sum, item) => sum + item.fileCount, 0);
const sourceTotalSize = sourceStats.reduce((sum, item) => sum + item.totalSize, 0);
const sourceRows = sourceStats.flatMap((item, index) => item.rows.map((row) => ({
  path: runtimeDirectories[index] + "/" + row.path, size: row.size, sha256: row.sha256
}))).sort((a, b) => a.path.localeCompare(b.path, "en"));
const sourceAggregate = crypto.createHash("sha256");
for (const row of sourceRows) sourceAggregate.update(row.path + "\0" + row.size + "\0" + row.sha256 + "\n", "utf8");
const sourceSha256 = sourceAggregate.digest("hex");
if (sourceFileCount !== stagingStats.fileCount || sourceTotalSize !== stagingStats.totalSize || sourceSha256 !== stagingStats.aggregateSha256) {
  throw new Error("Source/staging count, size, or SHA-256 mismatch.");
}

const report = { build: "1.0.3", builtAt: new Date().toISOString(), sourceRoot, stagingRoot,
  sourceFileCount, sourceTotalSize, sourceSha256, stagingFileCount: stagingStats.fileCount, stagingTotalSize: stagingStats.totalSize,
  stagingSha256: stagingStats.aggregateSha256, forbiddenEntries: forbidden };
fs.writeFileSync(path.join(projectRoot, "reports", "DEV_BUILD_REPORT.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
