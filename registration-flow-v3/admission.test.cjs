'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAdmission}=require('./admission.cjs');
test('one room is ordered while unrelated rooms are independent',async()=>{
 const admit=createAdmission(),log=[];
 let release;const gate=new Promise(r=>{release=r;});
 const a=admit('roomA',async()=>{log.push('a-start');await gate;log.push('a-end');});
 const b=admit('roomA',()=>{log.push('b');});
 await admit('roomB',()=>{log.push('other');});
 assert.deepEqual(log,['a-start','other']);
 release();await Promise.all([a,b]);assert.deepEqual(log,['a-start','other','a-end','b']);
});
test('failure does not poison next operation and overload has explicit response',async()=>{
 const admit=createAdmission({maxPending:2});
 const a=admit('roomA',()=>{throw Error('failed');});
 const b=admit('roomA',()=>42);
 await assert.rejects(admit('roomA',()=>0),/registration-busy/);
 await assert.rejects(a,/failed/);
 assert.equal(await b,42);
 assert.equal(await admit('roomA',()=>7),7);
});
