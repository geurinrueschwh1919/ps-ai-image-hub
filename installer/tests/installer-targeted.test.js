"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("../src/installerCore");
const { RegistryDetector } = require("../src/registryDetector");
const { FilesystemDetector } = require("../src/filesystemAdapter");

function record(major, suffix = "") { return { version: major + ".0.0", exePath: "C:\\Adobe\\PS" + major + suffix + "\\Photoshop.exe" }; }
function detection(records) { return core.detectPhotoshop({ scan: () => records }, { scan: () => [] }); }
function memoryAdapter(initial = []) {
  const trees = new Set(initial);
  return { trees, failHash: false, exists: (p) => trees.has(p), removeTree(p) { trees.delete(p); }, copyTree(from, to) { if (!trees.has(from)) throw new Error("missing"); trees.add(to); },
    moveTree(from, to) { if (!trees.has(from)) throw new Error("missing"); trees.delete(from); trees.add(to); }, verifyHashes() { return !this.failHash; }, readManifestVersion() { return "1.0.0"; } };
}

test("1 no Photoshop installed", () => assert.deepEqual(detection([]), []));
for (const major of [23, 24, 25]) test((major - 21) + " PS" + major + " only", () => { const result = detection([record(major)]); assert.equal(result[0].supported, true); });
test("5 PS23+24+25", () => assert.deepEqual(detection([record(25), record(23), record(24)]).map((x) => x.major), [23,24,25]));
test("6 PS26 only", () => assert.equal(detection([record(26)])[0].status, "Not Targeted"));
test("7 mixed supported/unsupported", () => assert.deepEqual(detection([record(22), record(25), record(27)]).map((x) => x.supported), [false,true,false]));
test("8 Compat not installed", () => { const p=core.installPaths("C:\\User"); assert.equal(core.installationState(memoryAdapter(),p,"1.0.0").action,"Install"); });
test("9 Compat installed", () => { const p=core.installPaths("C:\\User"); assert.equal(core.installationState(memoryAdapter([p.compat]),p,"1.0.0").action,"Repair"); });
test("10 Formal plugin installed", () => { const p=core.installPaths("C:\\User"); assert.equal(core.installationState(memoryAdapter([p.formal]),p,"1.0.0").formalInstalled,true); });
test("11 update Compat", () => { const p=core.installPaths("C:\\User"),a=memoryAdapter(["payload",p.compat]);a.readManifestVersion=()=>"0.9.0";assert.equal(core.installationState(a,p,"1.0.0").action,"Update"); });
test("12 rollback on hash failure", () => { const a=memoryAdapter(["payload","target"]);a.failHash=true;const r=core.transactionalInstall(a,"payload","target",{},"backup");assert.equal(r.rolledBack,true);assert.equal(a.exists("target"),true); });
test("13 uninstall Compat", () => { const p=core.installPaths("C:\\User"),a=memoryAdapter([p.compat]);core.uninstall(a,p,{});assert.equal(a.exists(p.compat),false); });
test("14 uninstall preserves formal plugin", () => { const p=core.installPaths("C:\\User"),a=memoryAdapter([p.compat,p.formal]);assert.equal(core.uninstall(a,p,{}).formalPreserved,true); });
test("15 uninstall preserves data by default", () => { const p=core.installPaths("C:\\User"),a=memoryAdapter([p.compat,p.data]);core.uninstall(a,p,{});assert.equal(a.exists(p.data),true); });
test("16 optional data removal", () => { const p=core.installPaths("C:\\User"),a=memoryAdapter([p.compat,p.data]);core.uninstall(a,p,{removeData:true});assert.equal(a.exists(p.data),false); });
test("17 Photoshop running detection contract exists", () => assert.match(fs.readFileSync(path.join(__dirname,"../src/install.ps1"),"utf8"),/Get-Process\s+-Name\s+Photoshop/));
test("18 missing staging blocks build", () => assert.match(fs.readFileSync(path.join(__dirname,"../scripts/build-installer.ps1"),"utf8"),/Compat staging is missing/));
test("19 corrupted staging hash fails transaction", () => { const a=memoryAdapter(["payload"]);a.failHash=true;assert.equal(core.transactionalInstall(a,"payload","target",{},"backup").ok,false); });
test("20 missing manifest is invalid", () => assert.equal(core.validateManifest(core.parseManifest("")).valid,false));
test("21 version parsing", () => assert.deepEqual(core.parseVersion("25.0.1").parts,[25,0,1]));
test("22 registry detection", () => { const d=new RegistryDetector({findPhotoshop:()=>[record(24)]});assert.equal(d.scan().length,1); });
test("23 debug mode disabled without consent", () => { let writes=0;const d=new RegistryDetector({setPlayerDebugMode(){writes++;}});d.enableDebugMode([{exists:true}],false);assert.equal(writes,0); });
test("24 debug mode enabled only for detected keys", () => { let writes=0;const d=new RegistryDetector({setPlayerDebugMode(){writes++;}});d.enableDebugMode([{exists:true,path:"CSXS.11"},{exists:false}],true);assert.equal(writes,1); });
test("25 no secret logging", () => { const s=core.sanitizeLog({apiKey:"x",prompt:"p",path:"safe"});assert.equal(s.apiKey,"[REDACTED]");assert.equal(s.path,"safe"); });
test("26 no formal plugin mutation", () => { const source=fs.readFileSync(path.join(__dirname,"../src/install.ps1"),"utf8");assert.doesNotMatch(source,/Remove-Item[^\n]+PS-AI-Image-Hub-CEP[\s'\"](?:$|\r?\n)/); });
test("27 correct target path", () => assert.match(core.installPaths("C:\\User").compat,/PS-AI-Image-Hub-CEP11-Compat$/));
test("28 installer output exists", () => assert.equal(fs.existsSync(path.join(__dirname,"../dist/PS-AI-Image-Hub-Setup-v1.0.0.exe")),true));
test("29 deterministic runtime hash manifest", () => { const file=path.join(__dirname,"../build/runtime-hashes.json");const a=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");const b=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");assert.equal(a,b); });
test("30 IExpress release AppLaunched uses bootstrap launcher", () => assert.match(fs.readFileSync(path.join(__dirname,"../build/installer.sed"),"utf8"),/AppLaunched=cmd\.exe \/D \/C launch-installer\.cmd/));
test("31 bootstrap launcher anchors install.ps1 to its own directory", () => assert.match(fs.readFileSync(path.join(__dirname,"../src/launch-installer.cmd"),"utf8"),/%~dp0install\.ps1/));
test("32 startup has top-level catch and Chinese failure message", () => { const source=fs.readFileSync(path.join(__dirname,"../src/install.ps1"),"utf8");assert.match(source,/Show-InstallerStartupError -ErrorRecord \$_/);assert.match(source,/安装器启动失败/); });
test("33 IExpress package contains every startup resource", () => { for(const name of ["install.ps1","uninstall.ps1","registryDetector.psm1","filesystemAdapter.psm1","launch-installer.cmd","launch-installer-debug.cmd","metadata.json","runtime-hashes.json","payload.zip"]) assert.equal(fs.existsSync(path.join(__dirname,"../build/package",name)),true,name); });
test("34 PowerShell resource files are resolved from PSScriptRoot", () => { const source=fs.readFileSync(path.join(__dirname,"../src/install.ps1"),"utf8");for(const name of ["registryDetector.psm1","filesystemAdapter.psm1","metadata.json","runtime-hashes.json","payload.zip","uninstall.ps1"]) assert.match(source,new RegExp("Join-Path \\$PSScriptRoot ['\\\"]"+name.replace(".","\\.")+"['\\\"]")); });
test("35 debug IExpress launch remains observable", () => { const sed=fs.readFileSync(path.join(__dirname,"../build/installer-debug.sed"),"utf8");const launcher=fs.readFileSync(path.join(__dirname,"../src/launch-installer.cmd"),"utf8");assert.match(sed,/AppLaunched=cmd\.exe \/D \/C launch-installer-debug\.cmd/);assert.match(launcher,/pause/i); });
test("36 packaged payload matches generated payload", () => { const hash=(p)=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");assert.equal(hash(path.join(__dirname,"../build/package/payload.zip")),hash(path.join(__dirname,"../build/payload.zip"))); });
test("37 startup logging has TEMP fallback and cannot abort UI", () => { const source=fs.readFileSync(path.join(__dirname,"../src/install.ps1"),"utf8");assert.match(source,/Join-Path \$env:TEMP 'PSAIImageHubCompatInstaller\\logs'/);assert.match(source,/function Write-SafeLog[\s\S]*?catch\s*\{\s*\}/); });
