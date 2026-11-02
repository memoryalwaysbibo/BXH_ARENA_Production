'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{create}=require('../../modules/scoring/four-court-client.cjs');
const {fixture}=require('./trusted-fixture.cjs');
function setup(){
 const f=fixture('BXH-CLIENT1',6,false),rooms=[],watches=[],sent=[],views=[];let serial=0,send=async()=>({ok:true});
 const transport={watchRoom(code,next,error){const w={next,error,stopped:false};rooms.push(w);return ()=>w.stopped=true;},watchBucket(code,id,next,error){const w={id,next,error,stopped:false};watches.push(w);return ()=>w.stopped=true;},commitScore:async d=>{sent.push(d);return send(d);},manageSeats:async d=>{sent.push(d);return send(d);}};
 const client=create({transport,code:f.state.cloudCode,uid:'ref1',onView:v=>views.push(v),operationId:()=> 'client-operation-'+(++serial)});
 function ready(room=f.room,version='1'){rooms.at(-1).next({room,version});for(const bucket of B.encode(f.state,room.scoreStorage))watches.filter(w=>!w.stopped&&w.id===bucket.bucketId).at(-1).next({bucket});}
 return {f,rooms,watches,sent,views,client,ready,setSend:fn=>send=fn};
}
test('client waits for all authoritative buckets, uses root seat model and rejects old revisions',()=>{
 const h=setup();h.client.connect();h.ready();assert.equal(h.client.getView().status,'ready');
 const current=h.watches[0],bucket=B.encode(h.f.state,h.f.room.scoreStorage)[0],rows=JSON.parse(bucket.matches);rows[0].scoreA=2;rows[0].refereeSeatScoreRevision=1;
 current.next({bucket:{...bucket,revision:1,matches:JSON.stringify(rows)}});assert.equal(h.client.getView().state.matches[0].scoreA,2);
 current.next({bucket});assert.equal(h.client.getView().state.matches[0].scoreA,2);
 current.next({bucket:null});assert.equal(h.client.getView().status,'syncing');assert.equal(h.client.canScore(1),false);
 current.next({bucket});assert.equal(h.client.getView().status,'syncing');assert.equal(h.client.getView().state.matches[0].scoreA,2);
});
test('offline, cached and old lifecycle callbacks cannot enable scoring; reconnect reads current buckets',async()=>{
 const h=setup();h.client.connect();h.ready();const old=h.watches[0];h.client.disconnect();
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).reason,'not-synchronized');assert.equal(h.sent.length,0);
 h.client.connect();old.next({bucket:B.encode(h.f.state,h.f.room.scoreStorage)[0]});assert.equal(h.client.getView().status,'syncing');
 h.rooms.at(-1).next({room:h.f.room,version:'2',fromCache:true});assert.equal(h.watches.filter(w=>!w.stopped).length,0);
 h.f.state.matches[0].scoreA=3;h.ready(h.f.room,'3');assert.equal(h.client.getView().state.matches[0].scoreA,3);
 h.watches.filter(w=>!w.stopped)[0].error(Error('network-unavailable'));assert.equal(h.client.getView().status,'error');
 h.watches.filter(w=>!w.stopped)[1].next({bucket:B.encode(h.f.state,h.f.room.scoreStorage)[1]});assert.equal(h.client.getView().status,'error');
});
test('authorization failures clear private data and stop all existing listeners',()=>{
 const h=setup();h.client.connect();h.ready();h.watches[0].error(Error('profile-access-revoked'));
 assert.equal(h.client.getView().state,null);assert.equal(h.client.getView().status,'error');assert(h.rooms.every(w=>w.stopped));assert(h.watches.every(w=>w.stopped));
});
test('lost replies retain the exact operation for retry and never optimistically change scores',async()=>{
 const h=setup();h.client.connect();h.ready();h.setSend(async()=>{throw Error('lost-reply');});
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).ok,false);assert.equal(h.client.getView().state.matches[0].scoreA,0);
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).reason,'operation-pending');
 h.setSend(async()=>({ok:true,replayed:true}));assert.equal((await h.client.retry('score:m1')).ok,true);
 assert.deepEqual(h.sent[0],h.sent[1]);assert.equal(h.sent[0].expectedCourtRevision,1);assert.equal(h.sent[0].expectedScoreRevision,0);assert.equal(h.sent[0].state,undefined);
});
test('new epoch blocks retries and delayed old bucket callbacks; revoked seats cannot submit',async()=>{
 const h=setup();h.client.connect();h.ready();h.setSend(async()=>{throw Error('lost');});await h.client.score('m1','score',{side:'A',finish:'spin'});
 const old=h.watches[0],room=structuredClone(h.f.room);room.scoreStorage.epoch='new-epoch';room.refereeSeatsV1.courts['1'].main=null;h.ready(room,'2');
 old.next({bucket:B.encode(h.f.state,h.f.room.scoreStorage)[0]});assert.equal(h.client.getView().status,'ready');assert.equal(h.client.canScore(1),false);
 assert.equal((await h.client.retry('score:m1')).reason,'generation-changed');assert.equal(h.sent.length,1);
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).reason,'station-not-assigned');
 h.rooms.at(-1).next({room:h.f.room,version:'1'});assert.equal(h.client.canScore(1),false);
});
test('successful reply keeps scoring locked until subscription confirms its score revision',async()=>{
 const h=setup();h.client.connect();h.ready();h.setSend(async()=>({ok:true,scoreRevision:1}));
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).ok,true);
 assert.equal((await h.client.score('m1','score',{side:'A',finish:'spin'})).reason,'operation-pending');assert.equal(h.client.getView().retryable.length,0);
 h.f.state.matches[0].scoreA=1;h.f.state.matches[0].refereeSeatScoreRevision=1;
 const bucket=B.encode(h.f.state,h.f.room.scoreStorage)[0];h.watches[0].next({bucket:{...bucket,revision:1}});
 assert.equal(h.client.getView().pending.length,0);assert.equal(h.client.getView().state.matches[0].scoreA,1);
});
test('connection loss and reconnect retain the original command and operation id for retry',async()=>{
 const h=setup();h.client.connect();h.ready();h.setSend(async()=>{throw Error('lost-reply');});await h.client.score('m1','score',{side:'A',finish:'spin'});h.rooms.at(-1).error(Error('unavailable'));assert.equal(h.client.getView().status,'error');
 h.client.connect();h.ready(h.f.room,'2');h.setSend(async()=>({ok:true,replayed:true,scoreRevision:1}));await h.client.retry('score:m1');assert.deepEqual(h.sent[0],h.sent[1]);assert.equal(h.client.getView().pending.length,1);h.client.disconnect();
});

