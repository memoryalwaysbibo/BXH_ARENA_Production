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
test('same operation shares pending execution and cannot time out behind itself',async()=>{
 const hold=deferred(),admit=createAdmission(),operation={key:'same-user-operation',fingerprint:'same-payload'};let writes=0;
 const run=async()=>{writes++;await hold.promise;return 'committed';};
 const first=admit('A',run,operation),second=admit('A',run,operation);
 assert.equal(first,second);hold.resolve();assert.deepEqual(await Promise.all([first,second]),['committed','committed']);assert.equal(writes,1);
});
test('coalescing rejects payload conflicts and isolates users and rooms',async()=>{
 const hold=deferred(),admit=createAdmission(),op={key:'user1-op',fingerprint:'first'};let writes=0;
 const first=admit('A',async()=>{await hold.promise;writes++;},op);
 await assert.rejects(admit('A',async()=>{}, {...op,fingerprint:'changed'}),/operation-conflict/);
 const differentUser=admit('A',async()=>{writes++;},{key:'user2-op',fingerprint:'first'});
 await admit('B',async()=>{writes++;},op);assert.equal(writes,1);hold.resolve();await Promise.all([first,differentUser]);assert.equal(writes,3);
});
test('coalescing does not retain stale results after completion or rejection',async()=>{
 const admit=createAdmission(),operation={key:'one-op',fingerprint:'one-payload'};let executions=0;
 assert.equal(await admit('A',async()=>++executions,operation),1);
 assert.equal(await admit('A',async()=>++executions,operation),2);
 await assert.rejects(admit('A',async()=>{throw Error('failure');},operation),/failure/);
 assert.equal(await admit('A',async()=>++executions,operation),3);
});
test('production pending bound admits 128 and rejects the 129th without invoking it',async()=>{
 const hold=deferred(),admit=createAdmission();let executions=0;
 const pending=Array.from({length:128},()=>admit('A',async()=>{await hold.promise;executions++;}));
 await assert.rejects(admit('A',async()=>{executions+=1000;}),/registration-admission-pending: queue-full/);
 hold.resolve();await Promise.all(pending);assert.equal(executions,128);
});
