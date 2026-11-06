'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const storage=()=>{const map=new Map();return {map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const reply=()=>({challenge:{environment:'sandbox',challengeId:'c',revision:1,status:'accepted'}});
test('unknown response retries exact original request; reload restores pending without bearer credentials',async()=>{
  const {createController}=await import('../hunter-clash/hc01/controller.mjs');const s=storage(),calls=[];
  const client=createController({storage:s,clock:()=>100,requestId:()=> 'original',transport:async(op,input)=>{calls.push({op,input});throw Error('network');}});client.setSession('A');
  await assert.rejects(client.mutate('start',{challengeId:'c',expectedRevision:0}),/network/);
  await assert.rejects(client.mutate('cancel',{challengeId:'c',expectedRevision:0}),/pending-unresolved/);
  const restored=createController({storage:s,clock:()=>101,transport:async(op,input)=>{calls.push({op,input});return reply();}});restored.setSession('A');
  await restored.retry();assert.deepEqual(calls[0],calls[1]);assert.equal(restored.state().pending,null);assert.equal(s.map.size,0);
});
test('known rejection clears pending; malformed persistence or expired recovery never sends',async()=>{
  const {createController}=await import('../hunter-clash/hc01/controller.mjs');const s=storage();
  const c=createController({storage:s,clock:()=>700000,transport:async()=>{const e=Error('revision-conflict');e.definitive=true;throw e;},requestId:()=> 'r'});c.setSession('A');
  await assert.rejects(c.mutate('start',{challengeId:'c',expectedRevision:0}),/revision-conflict/);assert.equal(c.state().pending,null);
  s.setItem('hc01:pending:A',JSON.stringify({schemaVersion:1,uid:'A',savedAt:1,operation:'start',input:{requestId:'old'}}));c.setSession('A');assert.equal(c.state().pending,null);
});
test('late old-account response cannot replace newer session; logout removes pending storage',async()=>{
  const {createController}=await import('../hunter-clash/hc01/controller.mjs');const s=storage();let resolve;
  const c=createController({storage:s,clock:()=>1,requestId:()=> 'r',transport:()=>new Promise(r=>{resolve=r;})});c.setSession('A');
  const inFlight=c.mutate('start',{challengeId:'c',expectedRevision:0});c.setSession('B');resolve(reply());assert.equal(await inFlight,null);
  assert.equal(c.state().uid,'B');assert.equal(c.state().snapshot,null);assert.equal(s.map.size,0);c.dispose();assert.equal(c.state().uid,null);
});
test('scanner stop while permission is pending releases late camera tracks',async()=>{
  const {createScanner}=await import('../hunter-clash/hc01/scanner.mjs');let resolve,stops=0;const video={srcObject:null,play:async()=>{}};
  const scanner=createScanner({video,canvas:{},mediaDevices:{getUserMedia:()=>new Promise(r=>{resolve=r;})},onPairing:()=>{throw Error('must-not-scan');}});
  const pending=scanner.start();scanner.stop();resolve({getTracks:()=>[{stop:()=>stops++}]});await pending;assert.equal(stops,1);assert.equal(video.srcObject,null);
});
test('native scan validates payload and releases camera before callback',async()=>{
  const {createScanner}=await import('../hunter-clash/hc01/scanner.mjs');const token='x'.repeat(43);let stopped=false,found;
  const scanner=createScanner({video:{play:async()=>{}},canvas:{},mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>{stopped=true;}}]})},detectorFactory:()=>({detect:async()=>[{rawValue:'bxh-hc01:c:'+token}]}),onPairing:v=>{assert.equal(stopped,true);found=v;}});
  await scanner.start();assert.equal(found.challengeId,'c');scanner.dispose();
});
test('native failure falls back to pixel decoder; malformed QR cannot become a pairing',async()=>{
  const {createScanner,decodePairingPixels}=await import('../hunter-clash/hc01/scanner.mjs');let found,warning=0,scheduled;
  const context={drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})};const canvas={getContext:()=>context};
  const opts={video:{videoWidth:1,videoHeight:1,play:async()=>{}},canvas,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},detectorFactory:()=>({detect:async()=>{throw Error('unsupported');}}),schedule:f=>{scheduled=f;return 1;},unschedule(){},onMessage:()=>warning++,onPairing:v=>{found=v;}};
  const scanner=createScanner({...opts,decoder:()=>({data:'https://unrelated.example'})});await scanner.start();assert.equal(found,undefined);assert.equal(warning,1);assert.equal(typeof scheduled,'function');scanner.stop();
  assert.throws(()=>decodePairingPixels({data:[],width:1,height:1},()=>({data:'bad'})),/invalid-pairing/);
});

test('background sync does not block scoring or overwrite newer state and releases late old-account reads',async()=>{
  const {createController}=await import('../hunter-clash/hc01/controller.mjs');let resolveRead;
  const c=createController({transport:async op=>op==='getChallenge'?new Promise(resolve=>{resolveRead=resolve;}):{challenge:{challengeId:'c',revision:3}},requestId:()=> 'sync-race'});
  c.setSession('A');const sync=c.sync('c');assert.equal(c.state().busy,false);
  await c.mutate('recordRound',{challengeId:'c',expectedRevision:1,winnerUid:'A',finish:'spin'});
  resolveRead({challenge:{challengeId:'c',revision:2}});await sync;assert.equal(c.state().snapshot.revision,3);
  const late=c.sync('c');c.setSession('B');resolveRead({challenge:{challengeId:'c',revision:4}});await late;assert.equal(c.state().snapshot,null);
});
