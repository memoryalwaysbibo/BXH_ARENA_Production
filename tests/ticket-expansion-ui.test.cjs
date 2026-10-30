'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../ticket-expansion-ui.js','utf8');
function harness(amount=60){
 let current=true,modal,fail=false,release;const calls=[],storage=new Map(),applied=[],errors=[];
 const quote={ownerUid:'buyer',code:'BXH-TICKET',selected:[0,1,2].map(i=>({kind:'registration',id:'r'+i})),amountTwd:amount,additionalSeats:amount/20,unitPriceTwd:20,fromCapacity:32,toCapacity:32+amount/20,hash:'quote-one'};
 const s={window:{engagementService:{commerce:async payload=>{calls.push(JSON.parse(JSON.stringify(payload)));if(payload.action==='ticket-quote-promotion')return {ok:true,quote};if(fail)throw Error('network-timeout');return {ok:true,verified:true,amountTwd:amount,additionalSeats:amount/20};}}},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'stable-operation'}};
 vm.runInNewContext(source,s);const ctx={uid:'buyer',code:'BXH-TICKET',isCurrent:()=>current,busy(){},modal:m=>modal=m,error:e=>errors.push(e),apply:async(...args)=>applied.push(args)};
 return {s,quote,calls,storage,applied,errors,ctx,run:()=>s.window.BXHTicketExpansion.promote(ctx,quote.selected),modal:()=>modal,setCurrent:x=>current=x,setFail:x=>fail=x,delay:()=>{s.window.engagementService.commerce=p=>{calls.push(p);return new Promise(r=>release=r);};},finish:()=>release({ok:true,quote})};
}
test('paid expansion quotes only; a separate explicit confirmation performs the charge',async()=>{
 const h=harness();await h.run();assert.equal(h.calls.length,1);assert.match(h.modal().message,/60/);assert.match(h.modal().message,/32 → 35/);assert.match(h.modal().confirmLabel,/確認加購/);assert.equal(h.storage.size,0);
 await h.modal().onConfirm();assert.equal(h.calls.length,2);assert.equal(h.calls[1].accepted,true);assert.equal(h.calls[1].quoteHash,'quote-one');assert.equal(h.calls[1].selected.length,3);assert.equal(h.applied.length,1);assert.equal(h.storage.size,0);
});
test('cancelling a quote never invokes confirmation or creates a pending purchase',async()=>{const h=harness();await h.run();assert.equal(h.calls.filter(c=>c.action==='ticket-confirm-promotion').length,0);assert.equal(h.storage.size,0);});
test('free promotion skips paid modal but uses the same server transaction',async()=>{const h=harness(0);await h.run();assert.equal(h.calls.length,2);assert.equal(h.modal(),undefined);assert.match(h.applied[0][1],/無加購費用/);});
test('uncertain network result preserves exact operation across retries, including different next selection',async()=>{
 const h=harness();await h.run();h.setFail(true);await h.modal().onConfirm();assert.equal(h.storage.size,1);const original=h.calls[1];h.setFail(false);h.quote.selected=[{kind:'registration',id:'new'}];await h.run();assert.match(h.modal().title,/上一筆/);await h.modal().onConfirm();assert.deepEqual(h.calls[2],original);assert.equal(h.storage.size,0);
});
test('double confirmation cannot send two concurrent purchase requests',async()=>{
 const h=harness();await h.run();let resolve;h.s.window.engagementService.commerce=async p=>{h.calls.push(p);return new Promise(r=>resolve=r);};const confirm=h.modal().onConfirm;const first=confirm();await confirm();assert.equal(h.calls.length,2);resolve({ok:true,amountTwd:60,additionalSeats:3});await first;
});
test('late quote after account, room or mode switch cannot open a confirmation',async()=>{const h=harness();h.delay();const p=h.run();h.setCurrent(false);h.finish();await p;assert.equal(h.modal(),undefined);});
test('open modal cannot commit after identity or room changes',async()=>{const h=harness();await h.run();h.setCurrent(false);await h.modal().onConfirm();assert.equal(h.calls.length,1);});
test('late confirmation cannot apply private roster into a different account or room',async()=>{
 const h=harness();await h.run();let resolve;h.s.window.engagementService.commerce=()=>new Promise(r=>resolve=r);const p=h.modal().onConfirm();h.setCurrent(false);resolve({ok:true,amountTwd:60,additionalSeats:3});await p;assert.equal(h.applied.length,0);
});
test('storage failure prevents sending a paid request',async()=>{const h=harness();await h.run();h.s.sessionStorage.setItem=()=>{throw Error('storage-unavailable');};await h.modal().onConfirm();assert.equal(h.calls.length,1);assert.equal(h.applied.length,0);assert.equal(h.errors.length,1);});
test('changed quote clears failed intent and requires a fresh quote',async()=>{
 const h=harness();await h.run();h.s.window.engagementService.commerce=async()=>{throw Error('expansion-quote-changed');};await h.modal().onConfirm();assert.equal(h.storage.size,0);assert.match(h.errors[0],/重新確認報價/);
});
test('core routes ticket promotions before the ordinary free-eight path and provides batch selection',()=>{
 const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8'),cloud=fs.readFileSync(__dirname+'/../modules/cloud/cloud-runtime.js','utf8');
 assert.match(core,/async function peoplePromoteOnline[^\n]+\n\s+if\(isTicketRoomState\(\)\)return peoplePromoteTicket/);
 assert.match(core,/async function peoplePromoteLocal[^\n]+\n\s+if\(isTicketRoomState\(\)\)/);
 assert.match(core,/data-ticket-candidate/);assert.match(core,/people-promote-ticket-selected/);assert.match(core,/engagementSessionEpoch===context.epoch&&activeMode===context.mode/);
 assert.match(core,/onsiteLocked\|\|ticketRoom\?'disabled'/);assert.match(cloud,/ticket-promotion-required/);
 assert.match(fs.readFileSync(__dirname+'/../index.html','utf8'),/ticket-expansion-ui.js/);
});
