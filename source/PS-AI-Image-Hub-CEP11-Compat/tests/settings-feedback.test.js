"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {SettingsPanel}=require("../client/js/ui/settingsPanel");
test("provider selection, actions and feedback share the basic disclosure",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../client/js/ui/settingsPanel.js"),"utf8");
 const start=source.indexOf('<details id="settings-basic-disclosure"'),end=source.indexOf('</div></details>',start);
 for(const id of ["settings-provider-list","provider-test","provider-save","provider-message"]){const marker='id="'+id+'"';assert.equal(source.split(marker).length-1,1);assert.ok(source.indexOf(marker)>start&&source.indexOf(marker)<end);}
});
test("saved message expires, edit clears it, and late timers cannot clear a newer failure",()=>{
 const oldSet=global.setTimeout,oldClear=global.clearTimeout;let callbacks=[],cleared=[];
 global.setTimeout=(fn,delay)=>{assert.equal(delay,4000);callbacks.push(fn);return callbacks.length;};global.clearTimeout=id=>cleared.push(id);
 try{
   const panel={message:{},t:key=>key};
   SettingsPanel.prototype.showSavedMessage.call(panel,"apiServiceSaved");
   assert.equal(panel.message.textContent,"apiServiceSaved");callbacks[0]();assert.equal(panel.message.textContent,"");
   SettingsPanel.prototype.showSavedMessage.call(panel,"apiServiceSaved");SettingsPanel.prototype.clearSavedMessage.call(panel);
   assert.equal(panel.message.textContent,"");assert.ok(cleared.includes(2));
   SettingsPanel.prototype.showSavedMessage.call(panel,"aliyunConfigSaved");
   panel.message.textContent="save failed";panel.message.className="status-failed";callbacks[2]();
   assert.equal(panel.message.textContent,"save failed");
   SettingsPanel.prototype.clearSavedMessage.call(panel);assert.equal(panel.message.textContent,"save failed");
 }finally{global.setTimeout=oldSet;global.clearTimeout=oldClear;}
});
test("validation failure expands basic settings and remains visible",()=>{
 const p={message:{},basicDisclosure:{open:false},t:key=>key};
 SettingsPanel.prototype.showValidationError.call(p,"errorMissingBaseUrl");
 assert.equal(p.basicDisclosure.open,true);assert.equal(p.message.className,"status-failed");assert.equal(p.message.textContent,"errorMissingBaseUrl");
});
