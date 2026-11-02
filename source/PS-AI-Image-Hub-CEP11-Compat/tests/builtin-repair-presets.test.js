"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {BUILTIN_REPAIR_PRESETS}=require("../client/js/presets/builtinRepairPresets");
const {PromptPresetStore}=require("../client/js/presets/promptPresetStore");
const {PromptPresetRegistry}=require("../client/js/presets/promptPresetRegistry");
const {PromptPresetCompiler,applyCompiledPrompt,compilePromptPresetStack}=require("../client/js/presets/promptPresetCompiler");
function disk(){const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function registry(storage){const store=new PromptPresetStore({storage});return new PromptPresetRegistry({store,factoryPresets:BUILTIN_REPAIR_PRESETS});}
test("fresh profile offers ten distinct trusted built-ins without storing them as user imports",()=>{
 const r=registry(disk());assert.equal(r.list().length,10);assert.equal(new Set(r.list().map(p=>p.id)).size,10);
 assert.ok(r.list().every(p=>p.factory));assert.equal(r.store.load().length,0);
});
test("deleted built-in stays hidden across restart and explicit restore brings it back",()=>{
 const storage=disk(),first=registry(storage),id=first.list()[0].id;first.remove(id);
 const reopened=registry(storage);assert.equal(reopened.list().some(p=>p.id===id),false);assert.equal(reopened.list().length,9);
 reopened.restoreAllFactories();assert.equal(reopened.list().length,10);assert.ok(registry(storage).get(id));
});
test("registering and deleting user presets never drops built-ins or resurrects removed imports",()=>{
 const storage=disk(),r=registry(storage);r.register({id:"user-repair",title:"User repair",category:"other",promptTemplate:"user original",factory:false});
 assert.equal(r.list().length,11);assert.equal(r.store.load().length,1);
 r.remove("user-repair");assert.equal(r.list().length,10);r.restoreAllFactories();assert.equal(registry(storage).get("user-repair"),null);
});
test("existing user ID collisions are preserved rather than overwritten",()=>{
 const storage=disk(),store=new PromptPresetStore({storage}),id=BUILTIN_REPAIR_PRESETS[0].id;
 store.save([{id,title:"User owned",category:"other",promptTemplate:"keep me",factory:false}]);
 const r=registry(storage);assert.equal(r.get(id).title,"User owned");assert.equal(r.get(id).factory,false);r.restoreAllFactories();assert.equal(r.get(id).promptTemplate,"keep me");
});
test("built-in favorites and local names survive restart and favorite filtering",()=>{
 const storage=disk(),r=registry(storage),id=r.list()[0].id;r.toggleFavorite(id);r.rename(id,"我的修复");
 const reopened=registry(storage);assert.equal(reopened.get(id).displayTitle,"我的修复");assert.equal(reopened.list({category:"**favorites**"})[0].id,id);
 assert.equal(reopened.list({search:"人物照片"}).length,1);
});
test("all bundled repair presets compile and support replace append and Stack",()=>{
 const r=registry(disk()),compiler=new PromptPresetCompiler();
 for(const p of r.list()){const text=compiler.compile(p,{});assert.ok(text.length>10,p.title);assert.equal(applyCompiledPrompt("old",text,"replace").text,text);assert.ok(applyCompiledPrompt("old",text,"append").text.startsWith("old"));}
 const ids=r.list().slice(0,2).map(p=>({presetId:p.id,enabled:true,values:{}}));
 const result=compilePromptPresetStack(ids,r,compiler);assert.ok(result);
});
