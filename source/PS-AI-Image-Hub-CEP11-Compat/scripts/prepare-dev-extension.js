"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const cepRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(cepRoot, "..");
const outputsRoot = path.join(repositoryRoot, "outputs");
const destinationRoot = path.join(outputsRoot, "dev", "PS-AI-Image-Hub-CEP");
const reportPath = path.join(outputsRoot, "ps-ai-image-hub-cep-dev-report.json");
const runtimeDirectories = ["CSXS", "client", "host"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
function relative(root, file) { return path.relative(root, file).split(path.sep).join("/"); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function assertSafeDestination() {
  const expected = path.join("dev", "PS-AI-Image-Hub-CEP");
  const actual = path.relative(outputsRoot, destinationRoot);
  if (actual !== expected || actual.startsWith("..") || path.isAbsolute(actual)) throw new Error("Unsafe dev staging path: " + destinationRoot);
}

function main() {
  assertSafeDestination();
  const sourceFiles = runtimeDirectories.flatMap((directory) => walk(path.join(cepRoot, directory)));
  sourceFiles.forEach((file) => { if (fs.statSync(file).size === 0) throw new Error("Empty runtime file: " + file); });
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  sourceFiles.forEach((source) => {
    const target = path.join(destinationRoot, path.relative(cepRoot, source));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  });
  const stagedFiles = walk(destinationRoot);
  const mismatches = sourceFiles.filter((source) => hash(source) !== hash(path.join(destinationRoot, path.relative(cepRoot, source))));
  if (mismatches.length) throw new Error("Dev staging hash mismatch: " + mismatches.map((file) => relative(cepRoot, file)).join(", "));
  const forbidden = stagedFiles.filter((file) => /(^|\/)(tests?|fixtures?|node_modules|scripts?)(\/|$)|\.(?:log|tmp|bak)$/i.test(relative(destinationRoot, file)));
  if (forbidden.length) throw new Error("Forbidden dev staging files: " + forbidden.map((file) => relative(destinationRoot, file)).join(", "));
  const totalBytes = stagedFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const report = { generatedAt: new Date().toISOString(), channel: "dev", target: "Photoshop 2024 / 25.0 / CEP 11",
    destination: destinationRoot, fileCount: stagedFiles.length, totalBytes: totalBytes,
    totalKiB: Number((totalBytes / 1024).toFixed(2)), hashAlgorithm: "sha256", hashCompare: "passed", forbiddenFiles: [] };
  fs.mkdirSync(outputsRoot, { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("PASS: prepared dev CEP staging with " + report.fileCount + " files (" + report.totalKiB + " KiB), hashes matched.");
  console.log("Dev staging: " + destinationRoot); console.log("Report: " + reportPath);
}

main();
