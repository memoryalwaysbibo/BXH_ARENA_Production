'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSummaryDelivery}=require('./summary-delivery.cjs');
test('events in one window coalesce, events during sync request another pass',async()=>{
 let count=0,releaseDelay,releaseSync;
 const wait=new Promise(r=>{releaseDelay=r;});
 const syncing=new Promise(r=>{releaseSync=r;});
 const deliver=createSummaryDelivery({delay:()=>wait,sync:async()=>{count++;if(count===1)await syncing;return count;}});
 const a=deliver('BXH-ABC123'),b=deliver('BXH-ABC123');
 assert.equal(a,b);releaseDelay();await Promise.resolve();assert.equal(count,1);
 const c=deliver('BXH-ABC123');releaseSync();
 assert.equal(await c,2);assert.equal(await a,2);
});
test('failed sync rejects deliveries and later retry resumes',async()=>{
 let count=0;
 const deliver=createSummaryDelivery({delay:async()=>{},sync:async()=>{if(++count===1)throw Error('failed');return 'ok';}});
 const a=deliver('BXH-ABC123'),b=deliver('BXH-ABC123');
 await assert.rejects(a,/failed/);await assert.rejects(b,/failed/);
 assert.equal(await deliver('BXH-ABC123'),'ok');
});
