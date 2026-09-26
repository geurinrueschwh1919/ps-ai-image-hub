"use strict";

const path = require("node:path");
const { scanTree } = require("../../scripts/tree-hash");

const target = process.argv[2];
if (!target) throw new Error("A tree root is required.");
const result = scanTree(path.resolve(target));
process.stdout.write(JSON.stringify({
  FileCount: result.fileCount,
  TotalSize: result.totalSize,
  SHA256: result.aggregateSha256
}));
