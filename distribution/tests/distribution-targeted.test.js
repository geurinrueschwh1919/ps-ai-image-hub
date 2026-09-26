"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const distributionRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(distributionRoot, "..");
const folderName = "PSAIHub-Compat";
const zipName = folderName + ".zip";
const releaseSourceName = "PS-AI-Image-Hub-Setup-v1.0.0.exe";
const debugSourceName = "PS-AI-Image-Hub-Setup-v1.0.0-Debug.exe";
const releaseName = "PSAIHub-Setup.exe";
const debugName = "PSAIHub-Debug.exe";
const zipPath = path.join(distributionRoot, "dist", zipName);
const zipHashPath = zipPath + ".sha256.txt";
const installerDist = path.join(projectRoot, "installer", "dist");
const installerReleasePath = path.join(installerDist, releaseSourceName);
const installerDebugPath = path.join(installerDist, debugSourceName);
const directReleasePath = path.join(distributionRoot, "dist", releaseName);
const directDebugPath = path.join(distributionRoot, "dist", debugName);
const roundtripRoot = fs.mkdtempSync(path.join(os.tmpdir(), "psai-distribution-"));

const expanded = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  path.join(__dirname, "expand-archive.ps1"), "-Archive", zipPath, "-Destination", roundtripRoot], { encoding: "utf8" });
if (expanded.status !== 0) throw new Error("ZIP expansion failed: " + expanded.stderr);

const packageRoot = path.join(roundtripRoot, folderName);
const releasePath = path.join(packageRoot, releaseName);
const debugPath = path.join(packageRoot, "Debug", debugName);
const readmePath = path.join(packageRoot, "README-安装说明.txt");
const feedbackPath = path.join(packageRoot, "问题反馈模板.txt");
const checksumPath = path.join(packageRoot, "SHA256.txt");
const licensePath = path.join(packageRoot, "LICENSE.txt");
const noticesPath = path.join(packageRoot, "THIRD-PARTY-NOTICES.txt");
const readme = fs.readFileSync(readmePath, "utf8");
const feedback = fs.readFileSync(feedbackPath, "utf8");
const checksum = fs.readFileSync(checksumPath, "utf8");

function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
function relativeFiles() { return walk(packageRoot).map((file) => path.relative(packageRoot, file).replace(/\\/g, "/")).sort(); }
function checksumFor(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = checksum.match(new RegExp(escaped + "\\s+SHA-256:\\s+([a-f0-9]{64})", "i"));
  return match && match[1].toLowerCase();
}

test.after(() => fs.rmSync(roundtripRoot, { recursive: true, force: true }));

test("1 Release exists", () => { assert.ok(fs.statSync(installerReleasePath).size > 0); assert.ok(fs.statSync(directReleasePath).size > 0); });
test("2 Release hash matches expected", () => {
  const expectedReleaseHash = sha256(installerReleasePath);
  assert.equal(sha256(installerReleasePath), expectedReleaseHash);
  assert.equal(sha256(directReleasePath), expectedReleaseHash);
  assert.equal(sha256(releasePath), expectedReleaseHash);
  assert.equal(checksumFor(releaseName), expectedReleaseHash);
});
test("3 Debug exists", () => { assert.ok(fs.statSync(installerDebugPath).size > 0); assert.ok(fs.statSync(directDebugPath).size > 0); });
test("4 Debug hash matches expected", () => {
  const expectedDebugHash = sha256(installerDebugPath);
  assert.equal(sha256(installerDebugPath), expectedDebugHash);
  assert.equal(sha256(directDebugPath), expectedDebugHash);
  assert.equal(sha256(debugPath), expectedDebugHash);
  assert.equal(checksumFor(debugName), expectedDebugHash);
});
test("5 README and license notices exist", () => {
  assert.ok(fs.statSync(readmePath).size > 0);
  assert.ok(fs.statSync(licensePath).size > 0);
  assert.ok(fs.statSync(noticesPath).size > 0);
});
test("6 Feedback template exists", () => assert.ok(fs.statSync(feedbackPath).size > 0));
test("7 SHA256 exists", () => assert.ok(fs.statSync(checksumPath).size > 0));
test("8 ZIP exists", () => assert.ok(fs.statSync(zipPath).size > 0));
test("9 ZIP can open", () => assert.equal(expanded.status, 0));
test("10 root folder correct", () => assert.deepEqual(fs.readdirSync(roundtripRoot), [folderName]));
test("11 Release at root", () => assert.ok(fs.existsSync(releasePath)));
test("12 Debug under Debug", () => assert.ok(fs.existsSync(debugPath)));
test("13 no source or forbidden project content", () => {
  const forbidden = /(^|\/)(?:source|node_modules|src|build|reports|\.git|\.env|USER_DATA)(\/|$)|\.(?:js|jsx|ps1|psm1|json|md|template\.txt)$/i;
  assert.equal(relativeFiles().some((name) => forbidden.test(name)), false);
});
test("14 no tests", () => assert.equal(relativeFiles().some((name) => /(^|\/)tests?(\/|$)/i.test(name)), false));
test("15 no logs or temporary files", () => assert.equal(relativeFiles().some((name) => /(^|\/)logs?(\/|$)|\.(?:log|tmp)$|(^|\/)desktop\.ini$/i.test(name)), false));
test("16 no secrets", () => {
  const patterns = [/\bAuthorization\s*:/i, /\bBearer\s+\S+/i, /\bapi_key\b/i, /\bapikey\b/i,
    /\bapi-key\b/i, /sk-[A-Za-z0-9]/i, /DASHSCOPE_API_KEY/i, /token\s*=/i];
  for (const file of walk(packageRoot).filter((name) => /\.(?:txt|json|md)$/i.test(name))) {
    const text = fs.readFileSync(file, "utf8");
    patterns.forEach((pattern) => assert.doesNotMatch(text, pattern, path.basename(file) + " " + pattern));
  }
});
test("17 README contains PS23, PS24 and PS25", () => {
  for (const value of ["Photoshop 2022 / 23.x", "Photoshop 2023 / 24.x", "Photoshop 2024 / 25.x"]) {
    assert.ok(readme.includes(value));
  }
});
test("18 README contains install instructions", () => {
  assert.match(readme, /【安装方法】[\s\S]*完全关闭 Photoshop[\s\S]*解压整个 ZIP[\s\S]*双击/);
});
test("19 README contains image-quality protection description", () => {
  assert.match(readme, /【导入画质保护】[\s\S]*Canvas[\s\S]*不会放大/);
});
test("20 README contains quality-protected Smart Object upscale behavior", () => {
  assert.match(readme, /默认关闭“导入结果时匹配主图区域”/);
  assert.match(readme, /Canvas[\s\S]*不会放大/);
  assert.match(readme, /2048×1152[\s\S]*2560×1440[\s\S]*智能对象/);
  assert.match(readme, /4096×2160[\s\S]*1920×1080[\s\S]*允许缩小匹配/);
  assert.match(readme, /相同尺寸[\s\S]*不重新缩放、不重新编码/);
});
test("21 README contains uninstall instructions", () => assert.match(readme, /【卸载】[\s\S]*重新运行安装器[\s\S]*卸载/));
test("22 Feedback template contains image quality section", () => {
  for (const label of ["画质测试", "网站端图片尺寸", "插件图片尺寸", "Photoshop 画布尺寸", "“匹配主图区域”",
    "小图到大区域", "大图到小区域", "相同尺寸", "Photoshop 100% 视图下结果"]) assert.ok(feedback.includes(label));
});
test("23 Chinese filenames survive ZIP roundtrip", () => {
  assert.ok(relativeFiles().includes("README-安装说明.txt"));
  assert.ok(relativeFiles().includes("问题反馈模板.txt"));
});
test("24 ZIP SHA file matches actual ZIP", () => {
  const text = fs.readFileSync(zipHashPath, "utf8");
  assert.ok(text.includes(zipName));
  assert.ok(text.toLowerCase().includes(sha256(zipPath)));
});
test("25 no previous outdated EXE accidentally included", () => {
  assert.deepEqual(relativeFiles(), [
    "Debug/" + debugName,
    "README-安装说明.txt",
    "LICENSE.txt",
    "THIRD-PARTY-NOTICES.txt",
    releaseName,
    "SHA256.txt",
    "问题反馈模板.txt"
  ].sort());
  assert.deepEqual(relativeFiles().filter((name) => /\.exe$/i.test(name)).sort(), ["Debug/" + debugName, releaseName].sort());
});
test("26 package uses one short root directory", () => {
  assert.equal(folderName, "PSAIHub-Compat");
  assert.equal(fs.readdirSync(packageRoot).includes(folderName), false);
});
test("27 packaged paths stay short", () => {
  const entryLengths = relativeFiles().map((name) => (folderName + "/" + name).length);
  assert.ok(Math.max(...entryLengths) <= 50);
  assert.equal(zipName.length, 18);
});
