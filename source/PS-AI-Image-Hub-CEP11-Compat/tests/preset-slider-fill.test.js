"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {syncPromptPresetSliderFill,PromptPresetPanel}=require("../client/js/ui/promptPresetPanel");
test("preset track fills exactly at minimum midpoint and maximum without changing values",()=>{
 for(const [min,max,value,fill] of [[0,1,0,"0%"],[0,1,.5,"50%"],[0,1,1,"100%"],[-1,1,0,"50%"],[0,100,100,"100%"]]){
   let result;const input={min,max,value,style:{setProperty(key,v){assert.equal(key,"--preset-range-fill");result=v;}}};
   syncPromptPresetSliderFill(input);assert.equal(result,fill);assert.equal(input.value,value);
 }
});
test("slider rendering restores full fill and input event updates both fill and numeric readout",()=>{
 const original=global.document;const nodes=[];
 global.document={createElement(tag){const node={tag,children:[],events:{},style:{setProperty(k,v){this[k]=v;}},appendChild(n){this.children.push(n);},setAttribute(){},addEventListener(name,fn){this.events[name]=fn;}};nodes.push(node);return node;}};
 try{
   const p={controls:{appendChild(){}},currentValues:{},saveCurrentValues(){}};
   PromptPresetPanel.prototype.renderControls.call(p,{controls:[{id:"strength",type:"slider",label:"Strength",min:0,max:1,step:.1,default:.5}]},{strength:1});
   const input=nodes.find(n=>n.type==="range"),output=nodes.find(n=>n.className==="preset-slider-value");
   assert.equal(input.value,1);assert.equal(input.style["--preset-range-fill"],"100%");assert.equal(output.textContent,1);
   input.value=.3;input.events.input();assert.equal(input.style["--preset-range-fill"],"30%");assert.equal(output.textContent,.3);
   assert.equal(input.max,1);assert.equal(input.step,.1);
 }finally{global.document=original;}
});
