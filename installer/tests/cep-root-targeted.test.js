"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const core = require("../src/installerCore");

const P = Object.freeze({
  systemX86: "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions",
  systemX64: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions",
  user: "D:\\Fixture\\UserData\\Adobe\\CEP\\extensions"
});
const formal = (root) => path.win32.join(root, core.EXPECTED.formalFolder);
const compat = (root) => path.win32.join(root, core.EXPECTED.installFolder);

function detector(existing = [], admin = false, versions = {}) {
  const set = new Set(existing.map((item) => item.toLowerCase()));
  const adapter = { exists: (value) => set.has(String(value).toLowerCase()), readManifestVersion: (value) => versions[value] || "1.0.0", readManifest: () => ({ bundleId: core.EXPECTED.bundleId, extensionId: core.EXPECTED.extensionId }) };
  const roots = core.createCepRoots(P, adapter, admin);
  const state = core.detectCepInstallations(roots, adapter);
  return { adapter, roots, state, recommended: core.selectRecommendedCepRoot(roots, state) };
}

function memoryAdapter(initial = []) {
  const trees = new Set(initial); let verificationCount = 0;
  return { trees, failStage: false, exists: (p) => trees.has(p), removeTree: (p) => trees.delete(p), copyTree(from,to){ if(!trees.has(from)) throw new Error("missing");trees.add(to); }, moveTree(from,to){if(!trees.has(from))throw new Error("missing");trees.delete(from);trees.add(to);}, verifyHashes(p){verificationCount++;return !(this.failStage && p.endsWith(".installing"));}, readManifestVersion(){return "1.0.0";} };
}

test("root 1 system-x86 root only",()=>{const x=detector([P.systemX86]);assert.equal(x.roots.find(r=>r.type==="system-x86").exists,true);});
test("root 2 system-x64 root only",()=>{const x=detector([P.systemX64]);assert.equal(x.roots.find(r=>r.type==="system-x64").exists,true);});
test("root 3 user root only",()=>{const x=detector([P.user]);assert.equal(x.recommended.root.type,"user");});
test("root 4 all roots exist",()=>assert.equal(detector(Object.values(P)).roots.filter(r=>r.exists).length,3));
test("root 5 no root exists",()=>{const x=detector([]);assert.equal(x.recommended.root.type,"user");assert.equal(x.recommended.source,"create-selected-only");});
test("root 6 formal in system-x86",()=>assert.equal(detector([P.systemX86,formal(P.systemX86)]).state.formalLocations[0].root.type,"system-x86"));
test("root 7 formal in system-x64",()=>assert.equal(detector([P.systemX64,formal(P.systemX64)]).recommended.root.type,"system-x64"));
test("root 8 formal in user root",()=>assert.equal(detector([P.user,formal(P.user)]).recommended.root.type,"user"));
test("root 9 formal absent",()=>assert.equal(detector([P.user]).state.formalInstalled,false));
test("root 10 compat in system-x86",()=>assert.equal(detector([P.systemX86,compat(P.systemX86)]).state.compatLocations[0].root.type,"system-x86"));
test("root 11 compat in user root",()=>assert.equal(detector([P.user,compat(P.user)]).recommended.root.type,"user"));
test("root 12 compat in multiple roots",()=>assert.equal(detector([P.systemX86,P.user,compat(P.systemX86),compat(P.user)]).state.compatLocations.length,2));
test("root 13 recommended root follows formal",()=>assert.equal(detector([P.systemX86,P.user,formal(P.systemX86)]).recommended.root.path,P.systemX86));
test("root 14 existing compat root preserved",()=>{const x=detector([P.user,compat(P.user)]);assert.equal(core.selectPrimaryCompat(x.state,x.recommended,null).rootPath,P.user);});
test("root 15 admin required",()=>assert.equal(core.adminInstallDecision({requiresAdmin:true},false,true).elevationRequired,true));
test("root 16 admin available",()=>assert.equal(core.adminInstallDecision({requiresAdmin:true},true,false).allowed,true));
test("root 17 admin denied",()=>assert.equal(core.adminInstallDecision({requiresAdmin:true},false,false).denied,true));
test("root 18 system install success",()=>{const a=memoryAdapter(["payload"]),r=core.transactionalInstall(a,"payload",compat(P.systemX86),{},"backup");assert.equal(r.ok,true);});
test("root 19 system repair success",()=>{const target=compat(P.systemX86),a=memoryAdapter(["payload",target]),r=core.transactionalInstall(a,"payload",target,{},"backup");assert.equal(r.action,"update-or-repair");});
test("root 20 system update success",()=>{const target=compat(P.systemX64),a=memoryAdapter(["payload",target]);a.readManifestVersion=()=>"9.0.0";assert.equal(core.transactionalInstall(a,"payload",target,{},"backup").ok,true);});
test("root 21 system rollback",()=>{const target=compat(P.systemX86),a=memoryAdapter(["payload",target]);a.failStage=true;const r=core.transactionalInstall(a,"payload",target,{},"backup");assert.equal(r.rolledBack,true);assert.equal(a.exists(target),true);});
test("root 22 system uninstall",()=>{const target=compat(P.systemX86),a=memoryAdapter([target]);core.uninstall(a,{compat:target,formal:formal(P.systemX86),data:"data"},{});assert.equal(a.exists(target),false);});
test("root 23 user install success",()=>{const a=memoryAdapter(["payload"]);assert.equal(core.transactionalInstall(a,"payload",compat(P.user),{},"backup").ok,true);});
test("root 24 user uninstall",()=>{const target=compat(P.user),a=memoryAdapter([target]);core.uninstall(a,{compat:target,formal:formal(P.user),data:"data"},{});assert.equal(a.exists(target),false);});
test("root 25 duplicate compat warning state",()=>assert.equal(detector([P.systemX86,P.user,compat(P.systemX86),compat(P.user)]).state.duplicateCompat,true));
test("root 26 formal plugin never removed",()=>{const target=compat(P.systemX86),formalPath=formal(P.systemX86),a=memoryAdapter([target,formalPath]);core.uninstall(a,{compat:target,formal:formalPath,data:"data"},{});assert.equal(a.exists(formalPath),true);});
test("root 27 invalid delete target rejected",()=>{const roots=detector(Object.values(P)).roots;assert.equal(core.validateCompatDeleteTarget(formal(P.systemX86),roots,{bundleId:"formal",extensionId:"formal"}),false);});
test("root 28 InstallLocation persisted",()=>{const values={},registry={set:(k,v)=>values[k]=v,get:(k)=>values[k]};core.persistInstallLocation(registry,P.systemX86,compat(P.systemX86),"1.0.0");assert.equal(core.resolvePersistedInstallLocation(registry).installPath,compat(P.systemX86));});
test("root 29 uninstall uses persisted location",()=>{const x=detector([P.systemX86,P.user,compat(P.systemX86),compat(P.user)]);assert.equal(core.resolveUninstallLocation(x.state,{installPath:compat(P.user)}).path,compat(P.user));});
test("root 30 open install location uses actual path",()=>{const x=detector([P.systemX86,compat(P.systemX86)]);assert.equal(core.resolveOpenLocation(x.state.compatLocations[0],x.roots[2]),compat(P.systemX86));});
