'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9097');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore');
(async()=>{
 const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));assert.equal(c.project,'demo-bxh-registration50');assert.equal(c.accounts.length,50);
 const app=initializeApp({projectId:c.project}),auth=getAuth(app),db=getFirestore(app);
 try{
  const ids=await Promise.all(c.accounts.map(async a=>{
   const response=await fetch('http://127.0.0.1:9097/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:a.email,password:a.password,returnSecureToken:true})});
   const r=await response.json();assert.equal(response.status,200);assert.equal(r.localId,a.uid);
   assert.equal((await auth.verifyIdToken(r.idToken)).uid,a.uid);
   const p=(await db.doc('users/'+a.uid).get()).data();assert.equal(p.role,'player');assert.equal(p.active,true);assert.equal(p.loadTestRun,c.run);return a.uid;
  }));
  assert.equal(new Set(ids).size,50);console.log(JSON.stringify({scope:'local Auth and Firestore emulators only',independentAccounts:50,passwordLoginsVerified:50,distinctTokenIdentities:50,cloudAccountsCreated:0,arenaSessionsOpened:0}));
 }finally{await db.terminate();await deleteApp(app);}
})().catch(()=>{console.error('emulator-login-verification-failed');process.exitCode=1;});
