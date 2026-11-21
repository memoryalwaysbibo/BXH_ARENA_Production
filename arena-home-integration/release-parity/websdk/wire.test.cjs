'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachBodyMeter}=require('./wire.cjs');
const listen='http://127.0.0.1:8188/google.firestore.v1.Firestore/Listen/channel';
async function make(){
 const session=new EventEmitter(),page=new EventEmitter();
 session.send=async()=>{};
 return {session,page,meter:await attachBodyMeter({newCDPSession:async()=>session},page)};
}
const start=(emitter,requestId,url)=>emitter.emit('Network.requestWillBeSent',{requestId,request:{url}});
const data=(emitter,requestId,n)=>emitter.emit('Network.dataReceived',{requestId,dataLength:n,encodedDataLength:0});
test('old open stream contributes chunks in update but no completed HTTP subset',async()=>{
 const {session,page,meter}=await make();
 meter.begin();
 start(session,'stream',listen);
 data(session,'stream',805);
 start(session,'external','https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');data(session,'external',900);
 const req={url:()=>listen,sizes:async()=>({requestBodySize:10,requestHeadersSize:20,responseBodySize:30,responseHeadersSize:40})};
 page.emit('request',req);page.emit('requestfinished',req);
 const cold=await meter.end();
 assert.equal(cold.firestoreResponseBodyBytes,805);
 assert.equal(cold.openKnownRequests,1);
 assert.equal(cold.completedHttpSizes.responseBodySize,30);
 assert.equal(cold.httpWithSizes,1);
 meter.begin();
 data(session,'stream',100);
 const delta=await meter.end();
 assert.equal(delta.firestoreResponseBodyBytes,100);
 assert.equal(delta.httpCompleted,0);
 assert.equal(delta.zeroEncodedChunks,1);
});
test('unrecognized nonempty Firestore path or absent chunks is unknown not zero',async()=>{
 const {session,meter}=await make();
 meter.begin();assert.equal((await meter.end()).firestoreResponseBodyBytes,null);
 meter.begin();start(session,'stream',listen);data(session,'stream',80);
 start(session,'unattributed','http://127.0.0.1:8188/not-a-firestore-path');data(session,'unattributed',20);
 assert.equal((await meter.end()).firestoreResponseBodyBytes,null);
});
