"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {MainPanel}=require("../client/js/ui/mainPanel");
test("selection constraint follows input type without changing the remembered checkbox",()=>{
 const p={mainPreview:{innerHTML:"",appendChild(){}},selectionConstraintField:{},selectionConstraint:{checked:false},createImageCard(){return{};},t:k=>k};
 for(const [type,hidden]of [[null,true],["current-canvas",true],["local-image",true],["current-selection",false],[null,true]]){
   p.mainImage=type?{sourceType:type}:null;MainPanel.prototype.renderMainImage.call(p);
   assert.equal(p.selectionConstraintField.hidden,hidden);assert.equal(p.selectionConstraint.checked,false);
 }
 const css=fs.readFileSync(path.join(__dirname,"../client/css/main.css"),"utf8");
 assert.match(css,/\.inline-check\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
test("compact host status preserves full document name as tooltip and labeled refresh",async()=>{
 const name="Very long document filename.jpg",p={hostStatus:{},photoshopBridge:{isAvailable(){return true;},async ping(){},async getPhotoshopVersion(){return"25.0";},async hasOpenDocument(){return true;},async getDocumentMetadata(){return{name};}},t:(k,v)=>k+" "+JSON.stringify(v)};
 await MainPanel.prototype.refreshHostInfo.call(p);assert.ok(p.hostStatus.textContent.startsWith("bridgeReadyDocumentCompact"));assert.ok(p.hostStatus.title.includes(name));
 const source=fs.readFileSync(path.join(__dirname,"../client/js/ui/mainPanel.js"),"utf8");
 assert.match(source,/id="refresh-host"[^>]+aria-label=/);
 assert.doesNotMatch(source,/<h2>\$\{this.t\("photoshopStatus"\)\}/);
});
