'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTw13HttpV2Handler}=require('../modules/bey-catalog/catalog-tw13-http-v2.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function research(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
  sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=0;i<5;i++)b.assemblyClaims.push({groupId:'group_'+i,verificationStatus:'supplier_pending'});
 for(let i=0;i<11;i++)b.variants.push({variantId:'variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=0;i<15;i++)b.parts.push({partId:'part_'+i,localizationStatus:'taiwan_name_pending'});
 while(SECTIONS.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'issue_'+b.issues.length});
 return b;
}
function harness({role='admin',appId='registered-app',rate=true,audit=true,revoked=false}={}){
 const events=[];let opts;
 const dependencies={
  allowedAppIds:['registered-app'],
  adminAppCheck:{verifyToken:async token=>{events.push('appcheck');if(token==='invalid')throw Error('INVALID_APP_CHECK');return {appId};}},
  adminAuth:{verifyIdToken:async(token,revocation)=>{events.push('auth');assert.equal(revocation,true);if(revoked)throw Error('TOKEN_REVOKED');return {uid:'admin_1',firebase:{sign_in_provider:'password'}};}},
  adminFirestore:{collection:()=>({doc:()=>({get:async()=>{events.push('profile');return {exists:true,data:()=>({role,active:true,isTestAccount:false})};}})})},
  loadResearchBatch:async()=>{events.push('research');return research();},
  consumeRateLimit:async()=>{events.push('quota');return rate;},
  recordAudit:async()=>{events.push('audit');return audit;}
 };
 const handler=createTw13HttpV2Handler({onRequest:(options,fn)=>{opts=options;return fn;},
  dependencies,allowedOrigins:['https://arena.bxh.com.tw']});
 async function send({method='POST',origin='https://arena.bxh.com.tw',body={limit:10},authorization='Bearer valid-id-token',appCheckToken='valid-app-check',contentType='application/json'}={}){
  const headers={origin,'content-type':contentType,authorization,'x-firebase-appcheck':appCheckToken};
  const response={code:null,headers:{},payload:null,status(n){this.code=n;return this;},set(k,v){this.headers[k]=v;return this;},json(v){this.payload=v;return this;},send(v){this.payload=v;return this;}};
  await handler({method,headers,body},response);
  return response;
 }
 return {events,send,options:opts};
}
test('Cloud Functions v2 factory is isolated, bounded and not deployed',()=>{
 const h=harness();
 assert.equal(h.options.cors,false);assert.equal(h.options.timeoutSeconds,30);
 assert.equal(h.options.maxInstances,3);
});
test('valid trusted admin receives paged read-only queue and audited access',async()=>{
 const h=harness(),r=await h.send();
 assert.equal(r.code,200);assert.equal(r.payload.summary.total,31);
 assert.equal(r.payload.items.length,10);assert.equal(r.payload.canPublish,false);
 assert.equal(r.headers['Cache-Control'],'no-store');
 assert.equal(r.headers['Access-Control-Allow-Origin'],'https://arena.bxh.com.tw');
 assert.deepEqual(h.events,['appcheck','auth','quota','auth','profile','research','audit']);
});
test('CORS origin, method, content type, payload and token blocked before any private access',async()=>{
 for(const params of [
  {origin:'https://evil.example'},{origin:undefined,method:'GET'},
  {method:'GET'},{contentType:'text/plain'},{body:{role:'super_admin'}},
  {body:{query:'a'.repeat(5000)}},{authorization:'Basic secret'},{appCheckToken:''}
 ]){
  const h=harness(),r=await h.send(params);
  assert.notEqual(r.code,200);assert.equal(h.events.length,0);
 }
});
test('preflight responds without invoking credentials or database',async()=>{
 const h=harness(),r=await h.send({method:'OPTIONS'});
 assert.equal(r.code,204);assert.equal(r.headers['Access-Control-Allow-Methods'],'POST, OPTIONS');
 assert.deepEqual(h.events,[]);
});
test('player, unregistered app, rate limit, revoked token and audit failure are fail-closed',async()=>{
 for(const [config,status] of [
  [{role:'player'},403],[{appId:'unregistered'},403],
  [{rate:false},429],[{revoked:true},503],[{audit:false},503]
 ]){
  const h=harness(config),r=await h.send();
  assert.equal(r.code,status,JSON.stringify(config));
  assert(!JSON.stringify(r.payload).includes('valid-id-token'));
  assert(!JSON.stringify(r.payload).includes('admin_1'));
 }
});
test('malformed trusted factory settings fail before a handler exists',()=>{
 assert.throws(()=>createTw13HttpV2Handler({}),/TW13_TRUSTED_FACTORY_CONFIG_REQUIRED/);
 assert.throws(()=>createTw13HttpV2Handler({onRequest:()=>{},dependencies:{},allowedOrigins:['*']}),/TW13_TRUSTED_FACTORY_CONFIG_REQUIRED/);
});
