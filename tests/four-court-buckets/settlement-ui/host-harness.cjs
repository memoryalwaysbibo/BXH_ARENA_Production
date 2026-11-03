'use strict';
// The same harness is run in Node and Chromium. Only SDK transport, auth and local storage are fixtures.
async function harness(src,f,o){
 const clone=x=>JSON.parse(JSON.stringify(x));let uid='admin',cloudWrites=0,legacy=0,localWrites=0,calls=0;
 const target={...JSON.parse(f.top.data),scoreStorage:clone(f.top.scoreStorage),archiveStatus:'ongoing'};
 let state=clone(target),recordIndex=[],ladderPublicLoaded=true,ladderAdminLogsLoaded=true,myLadderProfileCache={},cloudSyncPending=true;
 const authHandle={get currentUser(){return {uid};}},dbHandle={};
 const fx={doc:(db,...parts)=>({path:parts.join('/')}),runTransaction:async(db,fn)=>fn({get:async ref=>{
  const path=ref.path,value=path.startsWith('publicTournaments/')?f.pub:path.includes('/matchBuckets/')?f.buckets.find(b=>b.bucketId===path.split('/').at(-1)):f.top;
  return {exists:()=>!!value,data:()=>clone(value)};
 },set(){cloudWrites++;},update(){cloudWrites++;}})};
 const cloudEnabled=true;
 const window={BXHFourCourtSettlement:globalThis.BXHFourCourtSettlement,crypto:globalThis.crypto,cloudAuth:{getCurrentUser:()=>({uid})},engagementService:{settleLadder:async()=>{
  calls++;if(o.switchRoom)state={...state,cloudCode:'BXH-OTHER'};if(o.switchUser)uid='other';
  if(o.mode==='error')throw Error('offline');
  if(o.mode==='lost'){const completed=globalThis.__settlementCompleted;Object.assign(f,clone(completed));throw Error('lost response');}
  return {ok:false};
 }}};
 const tournamentCompletionKey=st=>st.id+'|'+st.cloudCode,isAdminTierOrAbove=()=>true;
 const saveRecordDetailed=async()=>{localWrites++;return {recordOk:!o.storageFail,indexOk:!o.storageFail};},loadIndex=async()=>[],addRecordSummaryToMemoryIndex=()=>{},render=()=>{},showToast=()=>{};
 const saveRecord=()=>{legacy++;throw Error('legacy save');};
 // Direct eval retains the actual app's lexical bindings; no replacement archive algorithm.
 const adapter=eval('({'+src.cloud+'})');window.cloudSync=adapter;
 const archive=eval('('+src.core.split('\nasync function performAutoArchiveState')[0]+')');
 // Actual entry guard must route before every legacy completion check/write.
 const entry=src.core.slice(src.core.indexOf('async function performAutoArchiveState'));
 const performBucketArchive=archive;
 const run=eval('('+entry+')');
 const ok=await run(target);
 return {ok,cloudWrites,legacy,localWrites,calls,code:state.cloudCode,archive:state.archiveStatus};
}
module.exports=async(src,f,o)=>{
 globalThis.BXHFourCourtSettlement=require('../../../modules/scoring/four-court-settlement.js');
 if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:require('node:crypto').webcrypto});
 globalThis.__settlementCompleted=require('./probe.cjs').fixture();
 return harness(src,f,o);
};
module.exports.harness=harness;
