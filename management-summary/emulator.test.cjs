'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('real Admin SDK projection, scoped search and cursor pages remain private', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const functionsRequire=require('node:module').createRequire(require('node:path').join(__dirname,'functions/package.json'));
 const {initializeApp,deleteApp}=functionsRequire('firebase-admin/app');
 const {getFirestore}=functionsRequire('firebase-admin/firestore');
 const {createSummaryHandler}=require('./functions/service.cjs');
 const app=initializeApp({projectId:'demo-bxh-management-summary'},'management-summary-test'),db=getFirestore(app),now=Date.now();
 try{
  await db.doc('users/actor').set({active:true,role:'admin'});
  await db.doc('users/player').set({active:true,role:'player'});
  await db.doc('users/tester').set({active:true,role:'tester'});
  const batch=db.batch();for(let i=0;i<12;i++)batch.set(db.doc('tournaments/BXH-'+String(i).padStart(6,'0')),{name:i===0?'雪山貓歷史賽':'Fixture '+i,eventDate:'2026-11-'+String(i+1).padStart(2,'0'),createdBy:'actor',eventAuthority:'official',registrationEnabled:true,registrationStatus:'open',data:JSON.stringify({players:[{uid:'PRIVATE_UID'}],matches:[{log:'PRIVATE_MATCH_LOG'}]}),bracketView:'PRIVATE_BRACKET',updatedAt:now});
  batch.set(db.doc('tournaments/BXH-TEST00'),{name:'Own test',createdBy:'tester',eventAuthority:'test',testMode:true,registrationEnabled:true,registrationStatus:'open'});
  await batch.commit();
  const list=createSummaryHandler(db),call=data=>list({auth:{uid:'actor'},data});
  const first=await call({});assert.equal(first.items.length,5);assert.equal(first.counts.all,13);assert.ok(first.hasMore);
  const second=await call({cursor:first.nextCursor});assert.equal(second.items.length,5);assert.ok(!second.items.some(item=>first.items.some(old=>old.code===item.code)));
  const found=await call({search:'雪山貓'});assert.equal(found.items.length,1);assert.equal(found.items[0].code,'BXH-000000');
  assert.ok(!JSON.stringify(first).includes('PRIVATE_'));assert.ok(!JSON.stringify(found).includes('PRIVATE_'));
  await assert.rejects(list({auth:{uid:'player'},data:{}}),/permission-denied/);
  const own=await list({auth:{uid:'tester'},data:{}});assert.deepEqual(own.items.map(item=>item.code),['BXH-TEST00']);
  await db.doc('users/actor').update({active:false});await assert.rejects(call({cursor:first.nextCursor}),/permission-denied/);
 }finally{await deleteApp(app);}
});
