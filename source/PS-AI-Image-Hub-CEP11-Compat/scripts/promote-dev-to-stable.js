"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const cepRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(cepRoot, "..");
const outputsRoot = path.join(repositoryRoot, "outputs");
const devRoot = path.join(outputsRoot, "dev", "PS-AI-Image-Hub-CEP");
const stableRoot = path.join(outputsRoot, "stable", "PS-AI-Image-Hub-CEP");
const temporaryRoot = path.join(outputsRoot, "stable", "PS-AI-Image-Hub-CEP-promoting");
const runtimeDirectories = ["CSXS", "client", "host"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
function relative(root, file) { return path.relative(root, file).split(path.sep).join("/"); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: cepRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(label + " failed; stable was not changed.");
}
function assertSafePaths() {
  if (path.relative(outputsRoot, stableRoot) !== path.join("stable", "PS-AI-Image-Hub-CEP")) throw new Error("Unsafe stable path.");
  if (path.relative(outputsRoot, temporaryRoot) !== path.join("stable", "PS-AI-Image-Hub-CEP-promoting")) throw new Error("Unsafe temporary path.");
}
function verifyDev() {
  if (!fs.existsSync(devRoot)) throw new Error("Dev staging does not exist. Run npm run prepare:dev first.");
  const sourceFiles = runtimeDirectories.flatMap((directory) => walk(path.join(cepRoot, directory)));
  const devFiles = walk(devRoot);
  const sourceNames = sourceFiles.map((file) => relative(cepRoot, file)).sort();
  const devNames = devFiles.map((file) => relative(devRoot, file)).sort();
  if (JSON.stringify(sourceNames) !== JSON.stringify(devNames)) throw new Error("Source/dev file lists differ; stable was not changed.");
  sourceFiles.forEach((source) => {
    const target = path.join(devRoot, path.relative(cepRoot, source));
    if (hash(source) !== hash(target)) throw new Error("Source/dev hash mismatch: " + relative(cepRoot, source));
  });
  const forbidden = devNames.filter((name) => /(^|\/)(tests?|fixtures?|node_modules|scripts?)(\/|$)|\.(?:log|tmp|bak)$/i.test(name));
  if (forbidden.length) throw new Error("Forbidden dev staging files: " + forbidden.join(", "));
}

function main() {
  assertSafePaths();
  run("CEP integrity", [path.join("scripts", "validate-cep.js")]);
  const tests = walk(path.join(cepRoot, "tests")).filter((file) => file.endsWith(".test.js"));
  run("Full regression", ["--test"].concat(tests));
  verifyDev();
  if (process.argv.indexOf("--verify-only") !== -1) {
    console.log("PASS: promotion preflight completed; stable was not changed.");
    return;
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.cpSync(devRoot, temporaryRoot, { recursive: true });
  fs.rmSync(stableRoot, { recursive: true, force: true });
  fs.renameSync(temporaryRoot, stableRoot);
  console.log("PASS: dev staging promoted to stable after regression, integrity, forbidden-file, and SHA-256 checks.");
  console.log("Stable staging: " + stableRoot);
}

main();
