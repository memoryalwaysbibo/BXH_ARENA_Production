'use strict';
// Real Admin SDK / Auth emulator / Firestore transaction integration; no production credentials.
const assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('emulator-required');
const deps=require('node:path').resolve(__dirname,'../hunter-clash/arena');const sdk=name=>require(require.resolve(name,{paths:[deps]}));
const {initializeApp}=sdk('firebase-admin/app'),{getAuth}=sdk('firebase-admin/auth'),{getFirestore}=sdk('firebase-admin/firestore');
const {createService}=require('../hunter-clash/arena/service.cjs'),adapter=require('../hunter-clash/arena/adapter.js');
(async()=>{const projectId='demo-arena-pk',app=initializeApp({projectId}),auth=getAuth(app),db=getFirestore(app),service=createService({db,auth});let seq=0;
 const tokens={};for(const uid of ['a','b','c','admin']){await auth.createUser({uid,email:uid+'@example.test',password:'emulator-password'});const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:uid+'@example.test',password:'emulator-password',returnSecureToken:true})});tokens[uid]=(await response.json()).idToken;await db.doc('users/'+uid).set({active:true,role:uid==='admin'?'super_admin':'player',displayName:uid});}
 await db.doc('systemSettings/hunterClash').set({enabled:true,environment:adapter.ENV,allowedUids:['a','b','c'],pairingTtlMs:120000,rules:{version:adapter.VERSION,targetScore:4}});
 const call=(uid,operation,input={})=>service.run(tokens[uid],operation,{...input,...(!['getChallenge','getMyHistory'].includes(operation)?{requestId:'e'+(++seq)}:{})});
 const created=await call('a','createChallenge',{matchCount:51});let c=(await call('b','acceptCode',{pairingCode:created.pairingCode,expectedRevision:0})).challenge;
 await assert.rejects(call('c','getChallenge',{challengeId:c.challengeId}),/participant-required/);
 for(const uid of ['a','b'])c=(await call(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;
 for(let i=0;i<51;i++){for(let j=0;j<2;j++)c=(await call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:i%2?'b':'a',finish:'burst'})).challenge;if(i<50)c=(await call('a','nextGame',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;}
 const race=await Promise.allSettled(['a','b'].map(uid=>call(uid,'confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/revision-conflict/);const pending=race.find(r=>r.status==='fulfilled').value.challenge,other=pending.finishConfirmedBy[0]==='a'?'b':'a';
 c=(await call(other,'confirmFinish',{challengeId:pending.challengeId,expectedRevision:pending.revision,resultRevision:pending.resultRevision})).challenge;
 const first=(await call('a','getMyHistory')).history,tail=(await call('a','getMyHistory',{cursor:first.nextCursor,generation:first.generation})).history;
 assert.equal(first.total,51);assert.equal(first.practiceXp.totalXp,22.5);assert.equal(first.practiceXp.remainingGames,0);assert.equal(tail.practiceXp.totalXp,22.5);assert.equal(first.rows.length,50);assert.equal(tail.rows.length,1);assert.equal(adapter.adapt([...first.rows,...tail.rows],'a').length,51);assert.equal((await call('b','getMyHistory')).history.losses,26);
 const revoke={challengeId:c.challengeId,expectedRevision:c.revision,reason:'emulator correction',requestId:'revoke-once'};await service.run(tokens.admin,'revokeChallenge',revoke);await service.run(tokens.admin,'revokeChallenge',revoke);assert.equal((await call('a','getMyHistory')).history.total,0);assert.equal((await call('a','getMyHistory')).history.practiceXp.totalXp,0);await assert.rejects(call('a','getMyHistory',{cursor:first.nextCursor,generation:first.generation}),/history-changed/);
 // SDK client REST cannot bypass the server ledger; emulator deny-all rules actually evaluated.
 const rest=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/v1/projects/'+projectId+'/databases/(default)/documents/arenaPKPlayers/a',{headers:{authorization:'Bearer '+tokens.a}});assert.equal(rest.status,403);

 // Distinct rooms settling together share daily counters in real Firestore.
 const nextDayService=createService({db,auth,clock:()=>Date.now()+86400000});
 const later=(uid,operation,input={})=>nextDayService.run(tokens[uid],operation,{...input,...(!['getChallenge','getMyHistory'].includes(operation)?{requestId:'later'+(++seq)}:{})});
 async function pendingRoom(){
  const out=await later('a','createChallenge');let c=(await later('b','acceptCode',{pairingCode:out.pairingCode,expectedRevision:0})).challenge;
  for(const uid of ['a','b'])c=(await later(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;
  for(let r=0;r<2;r++)c=(await later('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'a',finish:'burst'})).challenge;
  return (await later('a','confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})).challenge;
 }
 const rooms=[await pendingRoom(),await pendingRoom()];
 await Promise.all(rooms.map(c=>later('b','confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})));
 const xpHistory=(await later('a','getMyHistory')).history;assert.equal(xpHistory.practiceXp.totalXp,10);assert.equal(xpHistory.practiceXp.completedToday,2);
 await db.doc('users/b').update({active:false});await assert.rejects(call('b','getMyHistory'),/account-unavailable/);await assert.rejects(service.run('invalid-token','getMyHistory',{}));await db.terminate();console.log('PASS real Auth/Firestore SDK transactions, concurrent confirmation, 51 game paging, dual ledger, revoke replay, revoked auth and denied direct client reads');
})().catch(e=>{console.error(e);process.exitCode=1;});
