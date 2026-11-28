'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readTw12CatalogQueue}=require('../modules/bey-catalog/catalog-tw12-secure-read.cjs');
const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function batch(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
  sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=0;i<5;i++)b.assemblyClaims.push({groupId:'group_'+i,verificationStatus:'supplier_pending'});
 for(let i=0;i<11;i++)b.variants.push({variantId:'variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=0;i<15;i++)b.parts.push({partId:'part_'+i,localizationStatus:'taiwan_name_pending'});
 while(sections.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'issue_'+b.issues.length});
 return b;
}
function deps({appId='bxh-registered-app',role='admin',rateAllowed=true,auditAllowed=true,revoked=false}={}){
 const events=[];
 return {events,dependencies:{
  allowedAppIds:['bxh-registered-app'],
  adminAppCheck:{verifyToken:async token=>{events.push('app-check');if(token==='bad')throw Error('INVALID_APP_CHECK');return {appId};}},
  adminAuth:{verifyIdToken:async (token,revocationCheck)=>{events.push('auth');assert.equal(revocationCheck,true);if(revoked)throw Error('TOKEN_REVOKED');return {uid:'admin_1',firebase:{sign_in_provider:'password'}};}},
  adminFirestore:{collection:name=>{assert.equal(name,'users');return {doc:uid=>({get:async()=>{events.push('profile');assert.equal(uid,'admin_1');return {exists:true,data:()=>({role,active:true,isTestAccount:false})};}})};}},
  loadResearchBatch:async()=>{events.push('research');return batch();},
  consumeRateLimit:async args=>{events.push('rate');assert.deepEqual(args,{uid:'admin_1',operation:'tw12.catalog.review.read'});return rateAllowed;},
  recordAudit:async a=>{events.push('audit');assert.equal(a.uid,'admin_1');assert.equal(a.operation,'tw12.catalog.review.read');assert(!Object.hasOwn(a,'idToken'));assert(!Object.hasOwn(a,'query'));return auditAllowed;}
 }};
}
const args=d=>({dependencies:d.dependencies,appCheckToken:'valid-app-check',idToken:'valid-id-token',request:{limit:10}});
test('valid admin obtains read-only 31-item queue after App Check, auth, quota and audit',async()=>{
 const d=deps(),out=await readTw12CatalogQueue(args(d));
 assert.equal(out.access,'preview');assert.equal(out.summary.total,31);
 assert.equal(out.items.length,10);assert.equal(out.canPublish,false);assert.equal(out.canApprove,false);
 assert.deepEqual(d.events,['app-check','auth','rate','auth','profile','research','audit']);
});
test('unregistered App Check app rejected before auth or data access',async()=>{
 const d=deps({appId:'unknown-app'});
 await assert.rejects(()=>readTw12CatalogQueue(args(d)),/TW12_APP_CHECK_DENIED/);
 assert.deepEqual(d.events,['app-check']);
});
test('revoked auth and quota rejection block research',async()=>{
 const revoked=deps({revoked:true});
 await assert.rejects(()=>readTw12CatalogQueue(args(revoked)),/TOKEN_REVOKED/);
 assert.deepEqual(revoked.events,['app-check','auth']);
 const limited=deps({rateAllowed:false});
 await assert.rejects(()=>readTw12CatalogQueue(args(limited)),/TW12_RATE_LIMITED/);
 assert.deepEqual(limited.events,['app-check','auth','rate']);
});
test('audit failure fails closed and does not return private queue',async()=>{
 const d=deps({auditAllowed:false});
 await assert.rejects(()=>readTw12CatalogQueue(args(d)),/TW12_AUDIT_REQUIRED/);
 assert.equal(d.events.at(-1),'audit');
});
test('player is denied without loading research, but access attempt is audited',async()=>{
 const d=deps({role:'player'}),out=await readTw12CatalogQueue(args(d));
 assert.equal(out.access,'denied');assert.equal(out.items.length,0);
 assert(!d.events.includes('research'));assert(d.events.includes('audit'));
});
test('missing trusted security services and malformed request are rejected',async()=>{
 const d=deps();delete d.dependencies.consumeRateLimit;
 await assert.rejects(()=>readTw12CatalogQueue(args(d)),/TW12_TRUSTED_SERVER_DEPENDENCIES_REQUIRED/);
 const e=deps();
 await assert.rejects(()=>readTw12CatalogQueue({...args(e),request:{limit:500}}),/TW08_REQUEST_INVALID/);
 assert.deepEqual(e.events,[]);
});

test('identity changing between quota check and backend read fails closed',async()=>{
 const d=deps();
 let count=0;
 d.dependencies.adminAuth.verifyIdToken=async()=>({uid:++count===1?'admin_1':'other_admin',firebase:{sign_in_provider:'password'}});
 await assert.rejects(()=>readTw12CatalogQueue(args(d)),/TW12_AUTH_CONTEXT_MISMATCH/);
 assert(!d.events.includes('research'));
 assert(!d.events.includes('audit'));
});
