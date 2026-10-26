'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDiagnosticPanel}=require('../modules/main-app/rdw-diagnostic-panel.js');
function fixture(canInspect=true,provider=async()=>({ok:true,rosterSize:8,verifiedAccounts:2,virtualPlayers:6,unverifiedAccounts:0,fullSnapshotEligible:false,formulaBands:[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]})){
 const nodes=[];
 const doc={createElement(tag){return {tag,textContent:'',disabled:false,value:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(event,callback){this['on'+event]=callback;}};}};
 const container={ownerDocument:doc,appendChild(node){nodes.push(node);},removeChild(){nodes.shift();},get firstChild(){return nodes[0];}};
 const panel=createDiagnosticPanel({container,fetchDiagnostic:provider,canInspect});
 return {panel,nodes};
}
test('no admin authorization disables diagnostic request',async()=>{
 const f=fixture(false);assert.equal(f.panel.run.disabled,true);assert.equal(f.panel.status.textContent,'僅限已授權管理員');
});
test('trusted result displays 102/98 formula, 100/100 protected, no personally identifying data',async()=>{
 let calls=0;const f=fixture(true,async data=>{calls++;assert.equal(data.eventCode,'BXH-ABC123');return {ok:true,rosterSize:8,verifiedAccounts:2,virtualPlayers:6,unverifiedAccounts:0,fullSnapshotEligible:false,formulaBands:[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}],uid:'SECRET_UID',html:'<script>evil</script>'};});
 f.panel.code.value='BXH-ABC123';await f.panel.run.onclick();
 assert.equal(calls,1);assert.match(f.panel.output.textContent,/102% \/ 98%/);assert.match(f.panel.output.textContent,/100% \/ 100%/);
 assert.doesNotMatch(f.panel.output.textContent,/SECRET_UID|<script>/);assert.equal(f.panel.status.textContent,'唯讀檢查完成');
});
test('invalid code rejected without contacting backend',async()=>{
 let calls=0;const f=fixture(true,async()=>{calls++;});
 f.panel.code.value='INVALID';await f.panel.run.onclick();assert.equal(calls,0);assert.match(f.panel.status.textContent,/格式/);
});
test('untrusted backend response and provider error never display raw data',async()=>{
 for(const provider of [async()=>({ok:true,rosterSize:8,verifiedAccounts:2,virtualPlayers:6,unverifiedAccounts:0,formulaBands:[{rawForwardPercent:999,rawReversePercent:0,protectedForwardPercent:100,protectedReversePercent:100}]}),async()=>{throw Error('private document leaked');}]){
  const f=fixture(true,provider);f.panel.code.value='BXH-ABC123';await f.panel.run.onclick();assert.equal(f.panel.output.textContent,'');assert.doesNotMatch(f.panel.status.textContent,/private document/);
 }
});
