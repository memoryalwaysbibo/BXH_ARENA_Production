'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guardFirestore}=require('./guard-firestore.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(managed=true){
 const original={players:[{id:'p1',name:'Player',checkedIn:true,checkinAt:123}],...(managed?{qrCheckinManaged:true,qrCheckinRevision:2}:{})};
 const common=managed?{qrCheckinManaged:true,qrCheckinRevision:2,qrCheckin:{enabled:true,session:'S'}}:{};
 const docs=new Map([['tournaments/BXH-TEST01',{...common,data:JSON.stringify(original)}],['publicTournaments/BXH-TEST01',{...common,bracketView:JSON.stringify({players:original.players})}]]);
 const db={doc:path=>({path}),async runTransaction(fn){const writes=[];const tx={async get(ref){return {ref,exists:docs.has(ref.path),data:()=>clone(docs.get(ref.path))};},update(ref,patch){writes.push([ref.path,patch]);return tx;},set(ref,patch){writes.push([ref.path,patch]);return tx;}};const result=await fn(tx);for(const [path,p]of writes)docs.set(path,{...docs.get(path),...clone(p)});return result;}};
 return {db:guardFirestore(db),docs,original};
}
test('ordinary backend transaction preserves QR attendance and updates both mirrors',async()=>{
 const x=fixture();const r=await x.db.runTransaction(async tx=>{const tr=x.db.doc('tournaments/BXH-TEST01'),pr=x.db.doc('publicTournaments/BXH-TEST01');const t=await tx.get(tr);await tx.get(pr);const state=JSON.parse(t.data().data);state.players[0].checkedIn=false;tx.update(tr,{data:JSON.stringify(state)});tx.update(pr,{updatedAt:1});return {state};});
 assert.equal(r.state.players[0].checkedIn,true);assert.equal(r.state.qrCheckinRevision,3);assert.equal(x.docs.get('publicTournaments/BXH-TEST01').qrCheckinRevision,3);
});
test('missing peer write aborts the entire guarded transaction',async()=>{
 const x=fixture(),before=JSON.stringify([...x.docs]);await assert.rejects(x.db.runTransaction(async tx=>{const tr=x.db.doc('tournaments/BXH-TEST01');const t=await tx.get(tr);await tx.get(x.db.doc('publicTournaments/BXH-TEST01'));tx.update(tr,{data:t.data().data});}),/paired-write-required/);assert.equal(JSON.stringify([...x.docs]),before);
});
test('unmanaged room writes retain existing fields and no QR revision is added',async()=>{
 const x=fixture(false);await x.db.runTransaction(async tx=>{const tr=x.db.doc('tournaments/BXH-TEST01');const t=await tx.get(tr);tx.update(tr,{data:t.data().data,updatedAt:2});});assert.equal(x.docs.get('tournaments/BXH-TEST01').qrCheckinRevision,undefined);
});
test('guard is idempotent and unrelated collections are unaffected',async()=>{
 const x=fixture();assert.equal(guardFirestore(x.db),x.db);await x.db.runTransaction(async tx=>tx.set(x.db.doc('other/path'),{value:1}));assert.deepEqual(x.docs.get('other/path'),{value:1});
});
test('public-only projection cannot erase attendance in a managed room',async()=>{
 const x=fixture(),before=JSON.stringify([...x.docs]);
 await assert.rejects(x.db.runTransaction(async tx=>{const pr=x.db.doc('publicTournaments/BXH-TEST01');await tx.get(pr);tx.update(pr,{bracketView:JSON.stringify({players:[]})});}),/paired-write-required/);
 assert.equal(JSON.stringify([...x.docs]),before);
});
test('metadata-only public update leaves existing attendance intact',async()=>{
 const x=fixture();await x.db.runTransaction(async tx=>tx.update(x.db.doc('publicTournaments/BXH-TEST01'),{updatedAt:2}));
 assert.equal(JSON.parse(x.docs.get('publicTournaments/BXH-TEST01').bracketView).players[0].checkedIn,true);
});
test('managed root cannot be deleted through an ordinary transaction',async()=>{
 const x=fixture(),before=JSON.stringify([...x.docs]);
 await assert.rejects(x.db.runTransaction(async tx=>{const tr=x.db.doc('tournaments/BXH-TEST01');await tx.get(tr);tx.delete(tr);}),/audited-delete-required/);
 assert.equal(JSON.stringify([...x.docs]),before);
});
