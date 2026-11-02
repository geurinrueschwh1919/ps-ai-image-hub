"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),read=p=>fs.readFileSync(path.join(root,p),"utf8");
const {HistoryStore}=require("../client/js/storage/historyStore");
const {ProviderStore}=require("../client/js/storage/providerStore");
const {UiStateStore}=require("../client/js/storage/uiStateStore");
function texts(dir){let result=[];for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=dir+"/"+e.name;if(e.isDirectory())result=result.concat(texts(p));else if(/\.(?:js|jsx|xml|html)$/.test(p))result.push(read(p));}return result.join("\n");}
test("formal v1.1.0 panel manifest packages and fallback diagnostics agree",()=>{
 const manifest=read("CSXS/manifest.xml");assert.match(manifest,/ExtensionBundleVersion="1.1.0"/);assert.match(manifest,/panel" Version="1.1.0"/);
 assert.doesNotMatch(read("client/js/ui/mainPanel.js"),/class="app-header"|class="phase-badge"/);
 assert.match(read("client/js/ui/settingsPanel.js"),/<footer class="settings-version">V1.1.0<\/footer>/);
 assert.equal(JSON.parse(read("package.json")).version,"1.1.0");
 assert.match(read("client/js/compat/cepCompatibility.js"),/version: "1.1.0"/);
 assert.match(read("client/js/compat/hostCompatibility.js"),/extensionVersion: "1.1.0"/);
});
test("official runtime excludes Lab identity, Effects Lab, Glow and Color Fusion",()=>{
 const text=texts("client")+texts("host")+texts("CSXS");
 assert.doesNotMatch(text,/autosharpen\.lab|PSAIImageHubAutoSharpenLab|Auto Sharpen Lab|effectsLab|autoColorFusion|applyGlow/);
 assert.match(text,/com\.psai\.imagehub\.compat\.cep11\.panel/);
 assert.match(read("CSXS/manifest.xml"),/\[23\.0,26\.0\)/);assert.match(read("CSXS/manifest.xml"),/Name="CSXS" Version="11.0"/);
});
test("v1.0.3 history still loads original image paths without rewriting or deleting user data",()=>{
 const legacy=[{id:"old-1",status:"succeeded",localResultFile:"C:/user/PSAIImageHubCompat/history/images/old.jpg",prompt:"legacy",importContext:{targetBounds:{left:1,top:2,width:300,height:200}}}];
 let writes=0;const store=new HistoryStore({userDataRoot:"C:/user",photoshopBridge:{getUserDataRoot(){return"C:/user";}},cepFs:{readFile(p){assert.ok(p.endsWith("PSAIImageHubCompat\\history\\history.json"));return{err:0,data:JSON.stringify(legacy)};},writeFile(){writes++;}}});
 const loaded=store.load();assert.equal(loaded[0].id,"old-1");assert.equal(loaded[0].localResultFile,legacy[0].localResultFile);assert.deepEqual(loaded[0].importContext,legacy[0].importContext);assert.equal(writes,0);
});
test("v1.0.3 provider and UI preference keys remain official",()=>{
 let keys=[];const disk={getItem(key){keys.push(key);return key.endsWith("providers.v1")?JSON.stringify([{id:"custom-existing",type:"generic-rest",baseUrl:"https://example.test",modelId:"model-original"}]):JSON.stringify({matchMainSize:true,selectionPromptConstraint:false});}};
 const providers=new ProviderStore({storage:disk}).load();assert.equal(providers[0].id,"custom-existing");assert.equal(providers[0].modelId,"model-original");
 const preferences=new UiStateStore({storage:disk});assert.equal(preferences.getMatchMainSize(),true);assert.equal(preferences.getSelectionPromptConstraint(),false);assert.equal(preferences.getGenerationAdvancedOpen(),false);
 assert.ok(keys.every(key=>key.startsWith("ps-ai-image-hub.compat.cep11.")));
});
