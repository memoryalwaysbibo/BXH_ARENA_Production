'use strict';
/** Real Auth/Admin SDK negative-path regression; no research fixture or App Check service. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {createTw13HttpV2Handler}=require('../../modules/bey-catalog/catalog-tw13-http-v2.cjs');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('TW17_LOCAL_EMULATORS_REQUIRED');
const app=initializeApp({projectId:'demo-bxh-catalog-db01'},'tw17-real-auth');
const auth=getAuth(app),db=getFirestore(app);
const admin='tw17_admin',player='tw17_player';
let adminToken,playerToken,anonymousToken,researchLoads=0;
const handler=createTw13HttpV2Handler({onRequest:(options,fn)=>fn,allowedOrigins:['https://arena.bxh.com.tw'],dependencies:{
 allowedAppIds:['tw17-test-app'],adminAppCheck:{verifyToken:async()=>({appId:'tw17-test-app'})},
 adminAuth:auth,adminFirestore:db,
 loadResearchBatch:async()=>{researchLoads++;throw Error('RESEARCH_MUST_NOT_LOAD');},
 consumeRateLimit:async()=>true,recordAudit:async()=>true
}});
async function request(token){
 const response={set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(){return this;}};
 await handler({method:'POST',headers:{origin:'https://arena.bxh.com.tw','content-type':'application/json',authorization:'Bearer '+token,'x-firebase-appcheck':'tw17-test-app-token'},body:{}},response);
 return response;
}
before(async()=>{
 assert.equal(db.projectId,'demo-bxh-catalog-db01');
 const password='Emulator-only-password-20261009';
 async function post(method,body){
  const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:'+method+'?key=emulator-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(r.status,200);return r.json();
 }
 for(const uid of [admin,player])await auth.createUser({uid,email:uid+'@example.invalid',password});
 adminToken=(await post('signInWithPassword',{email:admin+'@example.invalid',password,returnSecureToken:true})).idToken;
 playerToken=(await post('signInWithPassword',{email:player+'@example.invalid',password,returnSecureToken:true})).idToken;
 anonymousToken=(await post('signUp',{returnSecureToken:true})).idToken;
 await db.collection('users').doc(admin).set({role:'super_admin',active:true,isTestAccount:false});
 await db.collection('users').doc(player).set({role:'player',active:true,isTestAccount:false});
});
after(async()=>deleteApp(app));
test('real Auth Emulator password login verified by Admin SDK with revocation check',async()=>{
 const decoded=await auth.verifyIdToken(adminToken,true);
 assert.equal(decoded.uid,admin);assert.equal(decoded.firebase.sign_in_provider,'password');
});
test('verified player receives 403 without loading private research',async()=>{
 const r=await request(playerToken);assert.equal(r.code,403);assert.deepEqual(r.body,{error:'FORBIDDEN'});assert.equal(researchLoads,0);
});
test('anonymous, malformed, wrong-project and expired tokens receive sanitized 401',async()=>{
 const pieces=adminToken.split('.'),claims=JSON.parse(Buffer.from(pieces[1],'base64url'));
 const tokenWith=patch=>[pieces[0],Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url'),pieces[2]].join('.');
 for(const token of [anonymousToken,'not-a-valid-jwt',tokenWith({aud:'demo-other-project'}),tokenWith({exp:1})]){
  const r=await request(token);assert.equal(r.code,401);assert.deepEqual(r.body,{error:'UNAUTHENTICATED'});
 }
 assert.equal(researchLoads,0);
});
test('disabled account and revoked ID token receive 401 before research loading',async()=>{
 await auth.updateUser(player,{disabled:true});
 assert.equal((await request(playerToken)).code,401);
 await new Promise(resolve=>setTimeout(resolve,1200));
 await auth.revokeRefreshTokens(admin);
 assert.equal((await request(adminToken)).code,401);
 assert.equal(researchLoads,0);
});
