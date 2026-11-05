'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAdmission}=require('./candidate/registration-admission.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('same room runs one mutation at a time; unrelated room is independent',async()=>{
 const admit=createAdmission(),hold=deferred(),entered=[];
 const first=admit('A',async()=>{entered.push(1);await hold.promise;});
 const second=admit('A',async()=>{entered.push(2);});
 await admit('B',async()=>{entered.push(3);});assert.deepEqual(entered,[1,3]);hold.resolve();await Promise.all([first,second]);assert.deepEqual(entered,[1,3,2]);
});
test('failure releases next waiter without poisoning room',async()=>{
 const admit=createAdmission();await assert.rejects(admit('A',async()=>{throw Error('failure');}),/failure/);assert.equal(await admit('A',async()=>42),42);
});
test('timed-out waiter cannot remove running predecessor fence',async()=>{
 const timers=[],hold=deferred(),admit=createAdmission({schedule:fn=>{timers.push(fn);return fn;},unschedule:()=>{}}),entered=[];
 const first=admit('A',async()=>{entered.push(1);await hold.promise;});
 await new Promise(setImmediate);
 const second=admit('A',async()=>{entered.push(2);});const rejected=assert.rejects(second,/queue-timeout/);timers[1]();await rejected;
 const third=admit('A',async()=>{entered.push(3);});await new Promise(setImmediate);assert.deepEqual(entered,[1]);hold.resolve();await Promise.all([first,third]);assert.deepEqual(entered,[1,3]);
});
test('bounded admission refuses excess without running it; room recovers',async()=>{
 const hold=deferred(),admit=createAdmission({maxPending:1});const first=admit('A',()=>hold.promise);
 await assert.rejects(admit('A',()=>{throw Error('must not run');}),/queue-full/);hold.resolve();await first;assert.equal(await admit('A',async()=>7),7);
});
