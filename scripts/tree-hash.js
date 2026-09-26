"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function scanTree(root) {
  const rows = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        rows.push({ path: path.relative(root, absolute).split(path.sep).join("/"), size: bytes.length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  const aggregate = crypto.createHash("sha256");
  for (const row of rows) aggregate.update(row.path + "\0" + row.size + "\0" + row.sha256 + "\n", "utf8");
  return { root, fileCount: rows.length, totalSize: rows.reduce((sum, row) => sum + row.size, 0),
    aggregateSha256: aggregate.digest("hex"), rows };
}

module.exports = { scanTree };
