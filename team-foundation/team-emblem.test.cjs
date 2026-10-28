'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {prepare,MAX_INPUT,MAX_OUTPUT}=require('./team-emblem.js');
const {hydrate}=require('./team-emblem.js');
test('prepare preserves the whole image in a bounded square and closes the bitmap',async()=>{
 let closed=0,drawn;const bitmap={width:800,height:400,close:()=>closed++};const canvas={getContext:()=>({clearRect(){},drawImage:(...args)=>{drawn=args;}}),toBlob:cb=>cb({type:'image/webp',size:1000})};
 const blob=await prepare({type:'image/png',size:1024},{decode:async()=>bitmap,canvasFactory:()=>canvas});assert.equal(blob.type,'image/webp');assert.equal(canvas.width,256);assert.equal(canvas.height,256);assert.deepEqual(drawn,[bitmap,0,64,256,128]);assert.equal(closed,1);
});
test('rejects unsupported, oversized, broken and unencodable images',async()=>{
 await assert.rejects(prepare({type:'image/svg+xml',size:100}),/invalid-image-type/);await assert.rejects(prepare({type:'image/png',size:MAX_INPUT+1}),/invalid-image-size/);
 let closed=0;const bitmap={width:6000,height:6000,close:()=>closed++};await assert.rejects(prepare({type:'image/png',size:100},{decode:async()=>bitmap}),/invalid-image-dimensions/);assert.equal(closed,1);
 const small={width:1,height:1,close:()=>closed++},canvas={getContext:()=>({clearRect(){},drawImage(){}}),toBlob:cb=>cb({type:'image/webp',size:MAX_OUTPUT+1})};
 await assert.rejects(prepare({type:'image/png',size:100},{decode:async()=>small,canvasFactory:()=>canvas}),/image-processing-failed/);assert.equal(closed,2);
});
test('page image hydration is capped at twenty items and three concurrent requests',async()=>{
 let calls=0,active=0,peak=0;const items=Array.from({length:25},(_,i)=>({id:'t'+i,hasEmblem:true}));
 const result=await hydrate({items,read:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;return {image:{contentType:'image/webp',base64:'UklGRgAAAABXRUJQ'}};}});
 assert.equal(calls,20);assert.equal(peak,3);assert.ok(result[19].emblemSource);assert.equal(result[20].emblemSource,undefined);assert.equal(items[0].emblemSource,undefined);
});
test('navigation cancels queued image requests and ignores late results',async()=>{
 let current=true,calls=0;const result=await hydrate({items:Array.from({length:20},(_,i)=>({id:'t'+i,hasEmblem:true})),isCurrent:()=>current,read:async()=>{calls++;await new Promise(setImmediate);current=false;return {image:{contentType:'image/webp',base64:'UklGRgAAAABXRUJQ'}};}});
 assert.equal(calls,3);assert.ok(result.every(x=>!x.emblemSource));
});
