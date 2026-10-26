'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCallableDiagnosticAdapter}=require('../modules/main-app/rdw-diagnostic-callable-adapter.js');
const {createDiagnosticPanel}=require('../modules/main-app/rdw-diagnostic-panel.js');
const code='BXH-ABC123';
const response={ok:true,eventCode:code,rosterSize:8,rosterRevision:4,verifiedAccounts:2,unverifiedAccounts:0,virtualPlayers:6,fullSnapshotEligible:false,policy:'ungraded-neutral-protected',formulaBands:[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]};
function fakeContainer(){
 const nodes=[],doc={createElement(tag){return {tag,textContent:'',disabled:false,value:'',setAttribute(){},addEventListener(kind,fn){this['on'+kind]=fn;}};}};
 return {ownerDocument:doc,appendChild(node){nodes.push(node);},removeChild(){nodes.shift();},get firstChild(){return nodes[0];}};
}
test('callable adapter plus UI verifies two-real-six-virtual preview end to end without writing',async()=>{
 let sent;
 const adapter=createCallableDiagnosticAdapter({enabled:true,invokeCallable:async payload=>{sent=payload;return {data:{...response,uid:'NEVER_RENDER',secret:'SECRET'}};}});
 const panel=createDiagnosticPanel({container:fakeContainer(),fetchDiagnostic:adapter,canInspect:true});
 panel.code.value=code;await panel.run.onclick();
 assert.deepEqual(sent,{eventCode:code});
 assert.match(panel.output.textContent,/102% \/ 98%/);assert.match(panel.output.textContent,/100% \/ 100%/);
 assert.doesNotMatch(panel.output.textContent,/SECRET|NEVER_RENDER/);
});
test('disabled callable cannot be activated by UI even when admin panel is visible',async()=>{
 const adapter=createCallableDiagnosticAdapter({invokeCallable:async()=>({data:response})});
 await assert.rejects(adapter({eventCode:code}),/disabled/);
 const panel=createDiagnosticPanel({container:fakeContainer(),fetchDiagnostic:adapter,canInspect:true});
 panel.code.value=code;await panel.run.onclick();assert.equal(panel.output.textContent,'');
});
test('backend envelope must match requested room and only event code can be sent',async()=>{
 const adapter=createCallableDiagnosticAdapter({enabled:true,invokeCallable:async()=>({data:{...response,eventCode:'BXH-OTHER1'}})});
 await assert.rejects(adapter({eventCode:code}),/envelope/);
 await assert.rejects(adapter({eventCode:'bad'}),/invalid-event-code/);
});
