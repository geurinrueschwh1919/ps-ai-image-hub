"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { scanTree } = require("./tree-hash");

const projectRoot = path.resolve(__dirname, "..");
const formalRoot = path.resolve(projectRoot, "..", "adobe-photoshop-uxp-ps-ai-image");
// Formal baseline captured after the 2026-09-14 Stable release finalization.
const expected = { fileCount: 468, totalSize: 5003103, aggregateSha256: "ae06e989134bd56cc51f0f4678e030d34ccbd8a5279b977d067830b065dd68c9" };
const actual = scanTree(formalRoot);
const git = spawnSync("git", ["-C", formalRoot, "status", "--short", "--branch"], { encoding: "utf8" });
const pass = actual.fileCount === expected.fileCount && actual.totalSize === expected.totalSize && actual.aggregateSha256 === expected.aggregateSha256;
const report = ["# Formal Project Read-Only Final Check", "", "- Check time: `" + new Date().toISOString() + "`",
  "- Formal project: `../adobe-photoshop-uxp-ps-ai-image`", "- Baseline files / final files: `" + expected.fileCount + " / " + actual.fileCount + "`",
  "- Baseline size / final size: `" + expected.totalSize + " / " + actual.totalSize + " bytes`",
  "- Baseline SHA-256: `" + expected.aggregateSha256 + "`", "- Final SHA-256: `" + actual.aggregateSha256 + "`",
  "- Git status: `" + (git.status === 0 ? (git.stdout.trim() || "clean") : "unavailable (not a Git worktree)") + "`",
  "- Result: **" + (pass ? "PASS — zero experiment-induced changes" : "FAIL — formal project changed") + "**", "",
  "Formal project is treated as read-only.", ""];
fs.writeFileSync(path.join(projectRoot, "reports", "FORMAL_PROJECT_READONLY_FINAL_CHECK.md"), report.join("\n"), "utf8");
console.log(report.join("\n"));
if (!pass) process.exitCode = 1;
