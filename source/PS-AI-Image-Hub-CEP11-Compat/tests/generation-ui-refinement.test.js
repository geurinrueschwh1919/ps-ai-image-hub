"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {MainPanel}=require("../client/js/ui/mainPanel");
const {UiStateStore,UI_PREFERENCES_STORAGE_KEY}=require("../client/js/storage/uiStateStore");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
function storage(initial){const values=new Map(initial?[[UI_PREFERENCES_STORAGE_KEY,JSON.stringify(initial)]]:[]);return{getItem(k){return values.get(k)||null;},setItem(k,v){values.set(k,v);},values};}
test("one generate/cancel action follows prompt and precedes presets and image inputs",()=>{
 const html=read("client/js/ui/mainPanel.js");
 assert.equal((html.match(/id="generate-button"/g)||[]).length,1);
 assert.equal((html.match(/id="cancel-generation"/g)||[]).length,1);
 const prompt=html.indexOf('id="prompt-input"'),generate=html.indexOf('id="generate-button"'),preset=html.indexOf('id="prompt-preset-container"');
 assert.ok(prompt<generate&&generate<preset);
 assert.match(html,/generateButton.addEventListener\("click", \(\) => this.handleGenerate\(\)\)/);
 assert.match(html,/cancelButton.addEventListener\("click", \(\) => this.generationManager.cancelGeneration\(\)\)/);
 assert.match(read("client/css/main.css"),/\.generate-action-bar \{ position: sticky;/);
});
test("advanced disclosure contains low-frequency controls while size and inputs remain outside",()=>{
 const html=read("client/js/ui/mainPanel.js"),start=html.indexOf('<details id="generation-advanced"'),end=html.indexOf('</div></details>',start);
 for(const id of ["provider-generation-options","auto-import","auto-sharpen-mode","custom-opacity-range"]){const pos=html.indexOf('id="'+id+'"');assert.ok(pos>start&&pos<end,id);}
 for(const id of ["main-preview","reference-preview","aspect-ratio","image-size"]){assert.ok(html.indexOf('id="'+id+'"')<start,id);}
});
test("advanced state defaults closed, survives reload, and preserves earlier preferences",()=>{
 const disk=storage({matchMainSize:true,selectionPromptConstraint:false});
 const store=new UiStateStore({storage:disk});assert.equal(store.getGenerationAdvancedOpen(),false);
 store.setGenerationAdvancedOpen(true);
 const reopened=new UiStateStore({storage:disk});assert.equal(reopened.getGenerationAdvancedOpen(),true);
 assert.equal(reopened.getMatchMainSize(),true);assert.equal(reopened.getSelectionPromptConstraint(),false);
 reopened.setMatchMainSize(false);assert.equal(new UiStateStore({storage:disk}).getGenerationAdvancedOpen(),true);
 reopened.setGenerationAdvancedOpen(false);assert.equal(new UiStateStore({storage:disk}).getGenerationAdvancedOpen(),false);
 assert.deepEqual([...disk.values.keys()],[UI_PREFERENCES_STORAGE_KEY]);
});
test("advanced summary reflects effective import and sharpening state without modifying controls",()=>{
 const translations={generationEnabled:"开启",generationDisabled:"关闭",autoSharpenOff:"不处理",autoSharpenMicro:"微锐化"};
 const p={generationAdvancedSummary:{},autoImport:{checked:true},autoSharpenMode:{value:"micro"},t(key,args){return args?args.autoImport+"/"+args.sharpen:translations[key];}};
 MainPanel.prototype.syncAdvancedSummary.call(p);assert.equal(p.generationAdvancedSummary.textContent,"开启/微锐化");
 p.autoSharpenMode.value="off";p.autoImport.checked=false;MainPanel.prototype.syncAdvancedSummary.call(p);
 assert.equal(p.generationAdvancedSummary.textContent,"关闭/不处理");assert.equal(p.autoSharpenMode.value,"off");
});
test("preview is available before import, collapses on success, reopens on failure",()=>{
 const result={importState:"notImported",images:[{original:"untouched.png"}]},p={currentResult:result,resultDetails:{open:false}};
 const sync=()=>MainPanel.prototype.syncResultDisclosure.call(p);
 sync();assert.equal(p.resultDetails.open,true);
 result.importState="importing";sync();assert.equal(p.resultDetails.open,true);
 result.importState="imported";sync();assert.equal(p.resultDetails.open,false);
 result.importState="failed";sync();assert.equal(p.resultDetails.open,true);
 assert.equal(result.images[0].original,"untouched.png");assert.equal(p.currentResult,result);
});
test("manually reopened successful preview remains open through unrelated UI refreshes",()=>{
 const p={currentResult:{importState:"imported"},resultDetails:{open:true}};
 const sync=()=>MainPanel.prototype.syncResultDisclosure.call(p);sync();assert.equal(p.resultDetails.open,false);
 p.resultDetails.open=true;for(let i=0;i<5;i++)sync();assert.equal(p.resultDetails.open,true);
 p.currentResult={importState:"imported"};sync();assert.equal(p.resultDetails.open,false);
 p.currentResult=null;sync();assert.equal(p.resultDetails.open,false);
});
test("pipeline import statuses drive disclosure for automatic, manual and Recovery imports",()=>{
 const result={importState:"notImported"};let statuses=[];
 const p={currentResult:result,resultDetails:{open:false},resultView:{render(){},updateImportState(){}},statusView:{update(s){statuses.push(s);}},syncControls(){MainPanel.prototype.syncResultDisclosure.call(this);}};
 for(const [status,state,open] of [["completed","notImported",true],["imported","imported",false],["importFailed","failed",true]]){
   result.importState=state;MainPanel.prototype.handlePipelineStatus.call(p,status,status==="completed"?result:{result});
   assert.equal(p.resultDetails.open,open);assert.equal(p.currentResult,result);
 }
 assert.deepEqual(statuses,["completed","imported","importFailed"]);
});
test("preview disclosure keeps original result view, manual import and sharpening actions",()=>{
 const html=read("client/js/ui/mainPanel.js"),start=html.indexOf('<details id="result-details"'),end=html.indexOf('</details>',start),section=html.slice(start,end);
 for(const id of ["result-container","import-button","manual-sharpen-button"])assert.ok(section.includes('id="'+id+'"'));
 assert.match(html,/manualSharpenButton.addEventListener\("click", \(\) => this.handleManualSharpen\(\)\)/);
 assert.doesNotMatch(html,/effectsLab|data-tab="effects"|autoColorFusion/);
});
