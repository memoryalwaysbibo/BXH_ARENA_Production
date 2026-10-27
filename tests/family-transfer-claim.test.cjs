'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../modules/main-app/family-transfer-claim.js');
const {complete}=globalThis.BXHFamilyTransferClaim;
const pending={active:true,accountStatus:'pending_family_transfer',familyTransferPending:true};
const normal={active:true,accountStatus:'normal',familyTransferPending:false};
test('production entrypoint loads claim before the auth handler and wires only the pending account',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
 assert.ok(html.indexOf('modules/main-app/family-transfer-claim.js?')<html.indexOf('id="bxh-main-app-m7"'));
 assert.match(core,/profile\.familyTransferPending===true && profile\.accountStatus==="pending_family_transfer"/);
 assert.match(core,/BXHFamilyTransferClaim\.complete\(/);
});
test('claims only a pending family account and confirms the refreshed profile',async()=>{
 let calls=0;
 const result=await complete({uid:'child',profile:pending,claim:async()=>{calls++;return {ok:true,status:'completed'};},reload:async()=>normal,isCurrent:()=>true});
 assert.equal(calls,1);assert.equal(result.claimed,true);assert.equal(result.profile,normal);
 const untouched=await complete({uid:'child',profile:normal,claim:()=>{throw Error('unexpected');}});
 assert.equal(untouched.profile,normal);
});
test('does not adopt a completed claim after the session changes',async()=>{
 let current=true;
 const result=await complete({uid:'switch',profile:pending,claim:async()=>{current=false;return {ok:true,status:'completed'};},reload:()=>{throw Error('stale read');},isCurrent:()=>current});
 assert.equal(result.profile,pending);assert.equal(result.claimed,false);
});
test('a server response without a cleared flag cannot silently unblock a transfer',async()=>{
 const result=await complete({uid:'uncleared',profile:pending,claim:async()=>({ok:true,status:'none'}),reload:async()=>pending,isCurrent:()=>true});
 assert.equal(result.error,'claim-unconfirmed');assert.equal(result.profile,pending);
});
test('failed claim leaves login usable and retries on the next auth pass',async()=>{
 const failed=await complete({uid:'retry',profile:pending,claim:async()=>{throw Error('offline');},reload:async()=>normal,isCurrent:()=>true});
 assert.equal(failed.error,'claim-failed');assert.equal(failed.profile,pending);
 const success=await complete({uid:'retry',profile:pending,claim:async()=>({ok:true,status:'completed'}),reload:async()=>normal,isCurrent:()=>true});
 assert.equal(success.claimed,true);
});
