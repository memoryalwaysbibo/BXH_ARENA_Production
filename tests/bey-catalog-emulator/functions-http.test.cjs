'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')
 throw Error('CATALOG_FUNCTIONS_TEST_EMULATORS_REQUIRED');
const PROJECT='demo-bxh-catalog-db01';
const URL='http://127.0.0.1:5009/'+PROJECT+'/us-central1/catalogReview';
const ORIGIN='https://arena.bxh.com.tw';
const app=initializeApp({projectId:PROJECT},'catalog-functions-http-test');
const auth=getAuth(app),db=getFirestore(app);
let adminToken,playerToken;
async function send({method='POST',origin=ORIGIN,token,appCheck='functions-emulator-app-check',body={}}={}){
 const headers={origin};
 if(method!=='GET'&&method!=='OPTIONS')headers['content-type']='application/json';
 if(token)headers.authorization='Bearer '+token;
 if(appCheck)headers['x-firebase-appcheck']=appCheck;
 const response=await fetch(URL,{method,headers,
  body:['GET','HEAD','OPTIONS'].includes(method)?undefined:(typeof body==='string'?body:JSON.stringify(body)),
  signal:AbortSignal.timeout(15000)});
 const raw=await response.text();
 let parsed=raw;try{parsed=raw?JSON.parse(raw):'';}catch(_){/* framework-owned parse error */}
 return {code:response.status,headers:Object.fromEntries(response.headers),raw,body:parsed};
}
before(async()=>{
 assert.equal((await auth.listUsers()).users.length,0,'clean Auth Emulator required');
 const password='Functions-emulator-only-20261010';
 async function authPost(method,body){
  const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:'+method+'?key=emulator-only',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);return response.json();
 }
 for(const uid of ['functions_admin','functions_player'])
  await auth.createUser({uid,email:uid+'@example.invalid',password});
 adminToken=(await authPost('signInWithPassword',{email:'functions_admin@example.invalid',password,returnSecureToken:true})).idToken;
 playerToken=(await authPost('signInWithPassword',{email:'functions_player@example.invalid',password,returnSecureToken:true})).idToken;
 await db.collection('users').doc('functions_admin').set({role:'super_admin',active:true,isTestAccount:false});
 await db.collection('users').doc('functions_player').set({role:'player',active:true,isTestAccount:false});
});
after(async()=>deleteApp(app));
test('Functions Emulator serves v2 onRequest with CORS and method gates',async()=>{
 const preflight=await send({method:'OPTIONS'});
 assert.equal(preflight.code,204);assert.equal(preflight.headers['access-control-allow-origin'],ORIGIN);
 assert.equal(preflight.headers['cache-control'],'no-store');
 assert.deepEqual((await send({method:'GET'})).body,{error:'METHOD_NOT_ALLOWED'});
 assert.deepEqual((await send({origin:'https://untrusted.example'})).body,{error:'ORIGIN_DENIED'});
});
test('real Auth Emulator identity reaches role gate through Functions Emulator',async()=>{
 const player=await send({token:playerToken});assert.equal(player.code,403);assert.deepEqual(player.body,{error:'FORBIDDEN'});
 const admin=await send({token:adminToken});assert.equal(admin.code,503);assert.deepEqual(admin.body,{error:'SERVICE_UNAVAILABLE'});
});
test('credential and payload failures stay closed at actual framework boundary',async()=>{
 const missing=await send();assert.equal(missing.code,401);assert.deepEqual(missing.body,{error:'UNAUTHENTICATED'});
 const badApp=await send({token:adminToken,appCheck:'wrong-app-check'});assert.equal(badApp.code,403);assert.deepEqual(badApp.body,{error:'APP_CHECK_DENIED'});
 const oversized=await send({token:adminToken,body:{query:'x'.repeat(5000)}});assert.equal(oversized.code,400);assert.deepEqual(oversized.body,{error:'INVALID_REQUEST'});
 const malformed=await send({token:adminToken,body:'{invalid-json'});assert.equal(malformed.code,400);
 assert(!malformed.raw.includes('invalid-json'));assert(!malformed.raw.toLowerCase().includes('stack'));
});
