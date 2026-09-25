'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','family-ui.js'),'utf8');
const start=src.indexOf('function mergeFamilyOnlineRoster(');
const end=src.indexOf('async function chooseFamilyRegistrationToCancel',start);
if(start<0||end<0)throw new Error('mergeFamilyOnlineRoster source block not found');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(src.slice(start,end),sandbox);

const merge=(players,rows,required)=>sandbox.mergeFamilyOnlineRoster(players,rows,required,()=> 'generated');

test('family child keeps checked-in state when registration id changes during sync',()=>{
 const players=[{id:'family_child-1',name:'孩子一',source:'online',registrationUid:'guardian-1',registrationId:'old-registration',familyPlayerId:'child-1',participantId:'child-1',guardianUid:'guardian-1',checkedIn:true}];
 const rows=[{status:'confirmed',uid:'guardian-1',guardianUid:'guardian-1',registrationId:'new-registration',familyPlayerId:'child-1',displayName:'孩子一'}];
 const out=merge(players,rows,true);
 assert.equal(out.length,1);
 assert.equal(out[0].id,'family_child-1');
 assert.equal(out[0].registrationId,'new-registration');
 assert.equal(out[0].checkedIn,true);
});

test('siblings under one guardian never inherit or overwrite each other check-in state',()=>{
 const players=[
  {id:'family_child-1',name:'孩子一',source:'online',registrationUid:'guardian-1',registrationId:'reg-1-old',familyPlayerId:'child-1',participantId:'child-1',guardianUid:'guardian-1',checkedIn:true},
  {id:'family_child-2',name:'孩子二',source:'online',registrationUid:'guardian-1',registrationId:'reg-2-old',familyPlayerId:'child-2',participantId:'child-2',guardianUid:'guardian-1',checkedIn:false}
 ];
 const rows=[
  {status:'confirmed',uid:'guardian-1',guardianUid:'guardian-1',registrationId:'reg-1-new',familyPlayerId:'child-1',displayName:'孩子一'},
  {status:'confirmed',uid:'guardian-1',guardianUid:'guardian-1',registrationId:'reg-2-new',familyPlayerId:'child-2',displayName:'孩子二'}
 ];
 const out=merge(players,rows,true);
 const one=out.find(x=>x.familyPlayerId==='child-1');
 const two=out.find(x=>x.familyPlayerId==='child-2');
 assert.equal(one.checkedIn,true);
 assert.equal(two.checkedIn,false);
});

test('cancelled sibling is removed even when another child under the same guardian remains confirmed',()=>{
 const players=[
  {id:'family_child-1',name:'孩子一',source:'online',registrationUid:'guardian-1',registrationId:'reg-1',familyPlayerId:'child-1',participantId:'child-1',guardianUid:'guardian-1',checkedIn:true},
  {id:'family_child-2',name:'孩子二',source:'online',registrationUid:'guardian-1',registrationId:'reg-2',familyPlayerId:'child-2',participantId:'child-2',guardianUid:'guardian-1',checkedIn:true}
 ];
 const rows=[{status:'confirmed',uid:'guardian-1',guardianUid:'guardian-1',registrationId:'reg-1',familyPlayerId:'child-1',displayName:'孩子一'}];
 const out=merge(players,rows,true);
 assert.deepEqual(out.map(x=>x.familyPlayerId),['child-1']);
 assert.equal(out[0].checkedIn,true);
});

test('new family registration still starts unchecked when check-in is required',()=>{
 const rows=[{status:'confirmed',uid:'guardian-1',guardianUid:'guardian-1',registrationId:'reg-new',familyPlayerId:'child-new',displayName:'新孩子'}];
 const out=merge([],rows,true);
 assert.equal(out.length,1);
 assert.equal(out[0].checkedIn,false);
});
