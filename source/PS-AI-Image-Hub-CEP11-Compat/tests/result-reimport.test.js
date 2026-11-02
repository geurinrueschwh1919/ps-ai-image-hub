"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {GenerationManager}=require("../client/js/generation/generationManager");
const {MainPanel}=require("../client/js/ui/mainPanel");
const {PhotoshopBridge}=require("../client/js/photoshop/bridge");
const {AutoSharpenManager}=require("../client/js/photoshop/autoSharpenManager");
function manager(importer){return new GenerationManager({imageImporter:{importImages:importer},t:key=>key});}
function result(){return {importState:"imported",historyId:"h1",images:[{importSource:{type:"url",url:"https://example.test/result.jpg"}}],importOptions:{matchMainSize:false},importResult:{items:[{documentId:1,layerId:2,layerName:"AI_Generated_001"}]}};}
test("explicit reimport uses saved original, updates target IDs, and never generates",async()=>{
 const r=result(),images=r.images;let calls=0;
 const m=manager(async input=>{calls++;assert.equal(input[0].importSource.type,"local-file");assert.equal(input[0].importSource.path,"original.jpg");return{imported:true,items:[{documentId:1,layerId:3,layerName:"AI_Generated_002"}]};});
 m.historyStore={load(){return[{id:"h1",localResultFile:"original.jpg",thumbnailFile:"thumb.jpg"}];}};
 m.generateOneClick=()=>{throw Error("must not generate");};
 await m.importGeneratedResult(r,{allowReimport:true});assert.equal(calls,1);assert.equal(r.importResult.items[0].layerId,3);assert.equal(r.importState,"imported");assert.equal(r.images,images);
 await assert.rejects(m.importGeneratedResult(r),e=>e.code==="RESULT_ALREADY_IMPORTED");
});
test("reimport can reuse source without History and concurrent import is still rejected",async()=>{
 let complete;const m=manager(()=>new Promise(resolve=>{complete=resolve;})),r=result();
 const first=m.importGeneratedResult(r,{allowReimport:true});
 await assert.rejects(m.importGeneratedResult(r,{allowReimport:true}),e=>e.code==="IMPORT_IN_PROGRESS");
 complete({imported:true,items:[]});await first;
});
test("failed explicit reimport retains the result and permits retry",async()=>{
 let calls=0;const m=manager(async()=>{if(++calls===1)throw Error("import failed");return{imported:true,items:[]};}),r=result(),images=r.images;
 await assert.rejects(m.importGeneratedResult(r,{allowReimport:true}));assert.equal(r.importState,"failed");assert.equal(r.images,images);
 await m.importGeneratedResult(r,{allowReimport:true});assert.equal(r.importState,"imported");
});
test("successful preview offers explicit reimport and respects busy state",()=>{
 const p={currentResult:result(),isGenerating:false,isImporting:false,capabilityAvailable(){return true;},importButton:{},manualSharpenButton:{},autoSharpenMode:{value:"off"},t:k=>k};
 MainPanel.prototype.syncImportButton.call(p);assert.equal(p.importButton.disabled,false);assert.equal(p.importButton.textContent,"importAgain");
 p.isImporting=true;MainPanel.prototype.syncImportButton.call(p);assert.equal(p.importButton.disabled,true);
});
test("manual import opts in explicitly and ignores repeated clicks while busy",async()=>{
 let calls=0;const p={currentResult:result(),syncControls(){},resultView:{updateImportState(){}},handlePipelineStatus(){},generationManager:{async importGeneratedResult(r,options){calls++;assert.equal(options.allowReimport,true);}}};
 p.isImporting=true;await MainPanel.prototype.handleManualImport.call(p);assert.equal(calls,0);
 p.isImporting=false;await MainPanel.prototype.handleManualImport.call(p);assert.equal(calls,1);
});
test("manual sharpen missing target reopens preview, disables stale target and prompts reimport",async()=>{
 const p={currentResult:result(),autoSharpenMode:{value:"micro"},autoSharpenManager:{isModeEnabled(){return true;},async applyToImportedLayer(){return{failed:true,reason:"target-layer-missing"};}},syncControls(){},syncResultDisclosure(){this.opened=true;},statusView:{update(status,details){assert.equal(details.message,"sharpenTargetMissing");}},t:k=>k};
 await MainPanel.prototype.handleManualSharpen.call(p);assert.equal(p.currentResult.importState,"notImported");assert.equal(p.opened,true);assert.equal(p.isImporting,false);
});
test("stable document/layer identities travel through sharpen plan and eight-argument bridge",async()=>{
 let plan,script;const m=new AutoSharpenManager({photoshopBridge:{async applyAutoSharpen(name,p){plan=p;return{applied:true};}}});
 await m.applyToImportedLayer({documentId:12,layerId:24,layerName:"Renamed"},{mode:"micro"});
 assert.equal(plan.targetDocumentId,12);assert.equal(plan.targetLayerId,24);
 const bridge=new PhotoshopBridge({csInterface:{evalScript(s,callback){script=s;callback('{"ok":true,"data":{"applied":true}}');}}});
 await bridge.applyAutoSharpen("Renamed",plan);assert.ok(script.includes('"psai-layer:12:24"'));
});
test("Host rejects deleted IDs and wrong active document before touching any layer",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../host/host.jsx"),"utf8");
 const section=source.slice(source.indexOf("  api.applyAutoSharpen ="),source.indexOf("  api._nextGeneratedLayerNameFromNames"));
 let nameLookups=0,duplicates=0;const doc={};let exists=false,active=true;
 const context={api:{},app:{documents:[doc],activeDocument:doc},documentById(){return active?doc:{};},findLayerById(){return exists?{duplicate(){duplicates++;throw Error("stop after correct target");}}:null;},findLayerByName(){nameLookups++;return{};},success:data=>({data}),failure:(code)=>({code}),Number,String,isFinite};
 vm.runInNewContext(section,context);
 const run=()=>context.api.applyAutoSharpen("psai-layer:12:24","linearLight",100,.5,false,0,0,false);
 assert.equal(run().code,"AUTO_SHARPEN_LAYER_MISSING");assert.equal(nameLookups,0);assert.equal(duplicates,0);
 exists=true;active=false;assert.equal(run().code,"AUTO_SHARPEN_DOCUMENT_INACTIVE");assert.equal(duplicates,0);
 active=true;run();assert.equal(duplicates,1);assert.equal(nameLookups,0);
});
