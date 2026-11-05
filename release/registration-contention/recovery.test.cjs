'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {handler,seed,audit}=require('./check.cjs');
const {create,definitive}=require('../../modules/main-app/registration-feedback.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
const join=(uid,code,operationId)=>({auth:{uid},data:{action:'join',code,childIds:[null],childEligibilityConfirmed:true,operationId}});
function memory(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function blocker(){const entered=deferred(),release=deferred();let once=true;return {entered,release,hook:async options=>{if(!options?.readOnly&&once){once=false;entered.resolve();await release.promise;}}};}
after(()=>require('firebase-admin/firestore').getFirestore().terminate());
for(const reason of ['queue-full','queue-timeout'])test(reason+' retains frontend pending result and same-operation retry recovers',async()=>{
 const block=blocker(),metrics=[],service=handler(true,metrics,{admissionOptions:{maxPending:reason==='queue-full'?1:128,waitMs:25},beforeTransaction:block.hook});
 const {code,ids:[one,two]}=await seed(service.db,2),first=service.call(join(one,code,'blocking-first-01'));
 await block.entered.promise;
 const request=join(two,code,'retry-original-01').data,storage=memory();let observed;
 const read=()=>service.call({auth:{uid:two},data:{action:'mine',code}});
 const control=create({getUid:()=>two,storage,read,retry:data=>service.call({auth:{uid:two},data}),slowMs:100000,deadlineMs:100000});
 try{
  await assert.rejects(control.run(code,async progress=>{progress.submitting([two],request);try{return await service.call({auth:{uid:two},data:request});}catch(error){observed=error;throw error;}}),/registration-result-pending/);
  assert(observed.message.includes(reason));assert.equal(definitive(observed),false);assert.equal(control.snapshot()[0].state,'unconfirmed');assert.equal(storage.length,1);
  block.release.resolve();await first;await tick();assert.equal((await control.retryOriginal(code)).status,'confirmed');assert.equal(control.snapshot()[0].state,'confirmed');assert.equal(storage.length,0);await audit(service.db,code,2);
 }finally{block.release.resolve();await first.catch(()=>{});control.dispose();}
});
test('independent scheduler timeout does not report an operation failed while peer later commits it',async()=>{
 const peerBlock=blocker(),localBlock=blocker(),peer=handler(true,[],{beforeTransaction:peerBlock.hook}),local=handler(true,[],{admissionOptions:{waitMs:25},beforeTransaction:localBlock.hook});
 const {code,ids:[user,other]}=await seed(peer.db,2),request=join(user,code,'cross-scheduler-01'),original=peer.call(request);
 await peerBlock.entered.promise;const busy=local.call(join(other,code,'other-blocker-01'));await localBlock.entered.promise;
 let feedbackNow=Date.now();
 const storage=memory(),control=create({getUid:()=>user,storage,read:()=>local.call({auth:{uid:user},data:{action:'mine',code}}),now:()=>feedbackNow,slowMs:100000,deadlineMs:100000});
 try{
  await assert.rejects(control.run(code,async progress=>{progress.submitting([user],request.data);return local.call(request);}),/registration-result-pending/);
  assert.equal(control.snapshot()[0].state,'unconfirmed');peerBlock.release.resolve();await original;await tick();feedbackNow+=3001;
  assert.equal((await control.recheck(code)).status,'confirmed');assert.equal(control.snapshot()[0].state,'confirmed');await audit(peer.db,code,1);
 }finally{peerBlock.release.resolve();localBlock.release.resolve();await Promise.allSettled([original,busy]);control.dispose();}
 await audit(peer.db,code,2);
});
test('same operation coalesces across factories without bypassing current cancellation readback',async()=>{
 const block=blocker(),metrics=[],service=handler(true,metrics,{beforeTransaction:block.hook}),{code,ids:[uid]}=await seed(service.db,1),request=join(uid,code,'coalesced-factory-01');
 const first=service.call(request);await block.entered.promise;
 const second=service.newFactory()(request);await tick();assert.equal(metrics.length,0);
 block.release.resolve();const results=await Promise.all([first,second]);assert(results.every(x=>x.ok));assert.equal(metrics.length,1);await audit(service.db,code,1);
 await service.call({auth:{uid},data:{action:'cancel',code,operationId:'after-coalesce-cancel'}});
 const replay=await service.newFactory()(request);assert.equal(replay.replayed,true);
 assert.equal((await service.call({auth:{uid},data:{action:'mine',code}})).rows[0].status,'cancelled');await audit(service.db,code,0);
});
test('deadline is rechecked after database admission delay and queued requests cannot enter after close',async()=>{
 const block=blocker();let now=Date.now();
 const service=handler(true,[],{clock:()=>now,beforeTransaction:block.hook}),{code,ids:[one,two]}=await seed(service.db,2);
 const first=service.call(join(one,code,'deadline-first-01'));const rejectedFirst=assert.rejects(first,/closed/);await block.entered.promise;
 const second=service.call(join(two,code,'deadline-second-01')),rejectedSecond=assert.rejects(second,/closed/);
 now+=7200000;block.release.resolve();await Promise.all([rejectedFirst,rejectedSecond]);await audit(service.db,code,0);
});
test('account disabled while queued is rejected before its mutation starts',async()=>{
 const block=blocker(),service=handler(true,[],{beforeTransaction:block.hook}),{code,ids:[one,two]}=await seed(service.db,2);
 const first=service.call(join(one,code,'revoke-first-01'));await block.entered.promise;
 const second=service.call(join(two,code,'revoke-second-01')),rejected=assert.rejects(second,/auth-required/);
 await service.db.doc('users/'+two).update({active:false});block.release.resolve();await first;await rejected;await audit(service.db,code,1);
});
