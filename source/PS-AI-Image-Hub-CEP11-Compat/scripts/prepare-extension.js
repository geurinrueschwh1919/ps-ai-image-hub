"use strict";

const fs = require("node:fs");
const path = require("node:path");

const cepRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(cepRoot, "..");
const outputsRoot = path.join(repositoryRoot, "outputs");
const destinationRoot = path.join(outputsRoot, "PS-AI-Image-Hub-CEP");
const reportPath = path.join(outputsRoot, "ps-ai-image-hub-cep-report.json");
const runtimeDirectories = ["CSXS", "client", "host"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function assertSafeDestination() {
  const relative = path.relative(outputsRoot, destinationRoot);
  if (relative !== "PS-AI-Image-Hub-CEP" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to clean an unsafe CEP staging path: " + destinationRoot);
  }
}

function main() {
  assertSafeDestination();
  const sourceFiles = runtimeDirectories.flatMap((directory) => walk(path.join(cepRoot, directory)));
  sourceFiles.forEach((file) => {
    if (fs.statSync(file).size === 0) throw new Error("CEP runtime file is empty: " + file);
  });

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  sourceFiles.forEach((source) => {
    const relative = path.relative(cepRoot, source);
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  });

  const stagedFiles = walk(destinationRoot);
  const totalBytes = stagedFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    extensionId: "com.psaiimagehub.cep.panel",
    version: "0.1.0",
    target: "Photoshop 2024 / 25.0 / CEP 11",
    destination: destinationRoot,
    fileCount: stagedFiles.length,
    totalBytes,
    totalKiB: Number((totalBytes / 1024).toFixed(2)),
    includedRoots: runtimeDirectories,
    excludedByDesign: ["tests/", "scripts/", "README-CEP.md", "CEP-COMPATIBILITY.md", "package.json", "enable-cep-debug.reg.example"]
  };
  fs.mkdirSync(outputsRoot, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("PASS: prepared CEP extension folder with " + stagedFiles.length + " files (" + report.totalKiB + " KiB)." );
  console.log("Extension folder: " + destinationRoot);
  console.log("Report: " + reportPath);
}

main();

