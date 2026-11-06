'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLifecycleService}=require('../hunter-clash/hc01/service.cjs');
const domain=require('../hunter-clash/hc01/domain.cjs');
const {memory}=require('./helpers/hc01-memory.cjs');
const env={FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098',GCLOUD_PROJECT:'demo-hunter-clash'};
function fixture(options={}){
  const {db,data}=memory();let now=10000;
  for(const uid of ['A','B','C'])data.set('hcActors/'+uid,{active:true,hc01Allowed:true,role:'player'});
  data.set('hcConfig/runtime',{enabled:true,environment:'sandbox',hc01Enabled:true,hc01Rules:{version:'sandbox-4-v1',targetScore:4},hc01PairingTtlMs:120000});
  const auth={app:{options:{projectId:'demo-hunter-clash'}},async verifyIdToken(token,checkRevoked){assert.equal(checkRevoked,true);if(!['A','B','C'].includes(token))throw Error('unauthenticated');return {uid:token};}};
  const service=createLifecycleService({db,auth,clock:()=>now},env,options);
  let seq=0;
  async function mutate(uid,operation,c,extra={}){return (await service.run(uid,operation,{challengeId:c.challengeId,requestId:'req_'+(++seq),expectedRevision:c.revision,...extra})).challenge;}
  async function pair(){const created=await service.run('A','createChallenge',{requestId:'create'});let c=await mutate('B','accept',created.challenge,{pairingToken:created.pairingToken});return c;}
  async function start(){let c=await pair();c=await mutate('A','start',c);return mutate('B','start',c);}
  return {service,data,mutate,pair,start,setNow:v=>{now=v;}};
}
test('complete two-player pairing, two starts, rounds and final confirmations without awards',async()=>{
  const f=fixture();let c=await f.start();assert.equal(c.status,'in_progress');
  for(const finish of ['extreme','spin']){c=await f.mutate('A','proposeRound',c,{winnerUid:'A',finish});const r=c.pendingRound.roundRevision;c=await f.mutate('B','confirmRound',c,{roundRevision:r});}
  assert.equal(c.status,'final_pending');assert.deepEqual(c.score,{a:4,b:0});
  c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'final_pending');
  c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');
  assert.equal(c.ratingStatus,'not_awarded');assert.equal(c.certificationSource,'SELF');
  assert.equal([...f.data.keys()].some(k=>/hunterData|ladder|mailbox|hcSettlement|hcSandboxStats/.test(k)),false);
});
test('same create request returns same secret; challenge/read projection never exposes it',async()=>{
  const f=fixture(),input={requestId:'create'};const a=await f.service.run('A','createChallenge',input),b=await f.service.run('A','createChallenge',input);
  assert.deepEqual(a,b);assert.equal(a.pairingToken.length,43);assert.equal('pairingTokenHash'in a.challenge,false);
  const view=await f.service.run('A','getChallenge',{challengeId:a.challenge.challengeId});assert.equal('pairingToken'in view,false);
  assert.equal(JSON.stringify(f.data.get('hc01Challenges/'+a.challenge.challengeId)).includes(a.pairingToken),false);
});
test('concurrent QR redemption accepts exactly one opponent; token cannot be reused',async()=>{
  const f=fixture(),a=await f.service.run('A','createChallenge',{requestId:'create'});
  const cmd=uid=>f.service.run(uid,'accept',{challengeId:a.challenge.challengeId,requestId:'accept',expectedRevision:0,pairingToken:a.pairingToken});
  const r=await Promise.allSettled([cmd('B'),cmd('C')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.data.get('hc01Challenges/'+a.challenge.challengeId).participants.length,2);
  await assert.rejects(f.service.run('B','accept',{challengeId:a.challenge.challengeId,requestId:'new',expectedRevision:1,pairingToken:a.pairingToken}),/pairing-unavailable/);
});
test('wrong token, creator self-pairing and unauthenticated caller reject without effects',async()=>{
  const f=fixture(),a=await f.service.run('A','createChallenge',{requestId:'create'}),before=f.data.size;
  await assert.rejects(f.mutate('A','accept',a.challenge,{pairingToken:a.pairingToken}),/pairing-unavailable/);
  await assert.rejects(f.mutate('B','accept',a.challenge,{pairingToken:'x'.repeat(43)}),/pairing-unavailable/);
  await assert.rejects(f.service.run('unknown','createChallenge',{requestId:'bad'}),/unauthenticated/);assert.equal(f.data.size,before);
});
test('pairing expiration is server-clock based and cannot start a match',async()=>{
  const f=fixture(),a=await f.service.run('A','createChallenge',{requestId:'create'});f.setNow(a.challenge.expiresAt);
  const c=await f.mutate('B','accept',a.challenge,{pairingToken:a.pairingToken});assert.equal(c.status,'expired');assert.deepEqual(c.participants,['A']);
  await assert.rejects(f.mutate('A','start',c),/terminal-state/);
});
test('one player cannot start twice, confirm own round or finalize before target',async()=>{
  const f=fixture();let c=await f.pair();c=await f.mutate('A','start',c);await assert.rejects(f.mutate('A','start',c),/invalid-state/);
  c=await f.mutate('B','start',c);await assert.rejects(f.mutate('A','confirmFinish',c,{resultRevision:0}),/finish-confirmation-invalid/);
  c=await f.mutate('A','proposeRound',c,{winnerUid:'B',finish:'spin'});
  await assert.rejects(f.mutate('A','confirmRound',c,{roundRevision:c.pendingRound.roundRevision}),/round-confirmation-invalid/);
});
test('replayed round acknowledgement is idempotent, altered request and stale revision reject',async()=>{
  const f=fixture();let c=await f.start();c=await f.mutate('A','proposeRound',c,{winnerUid:'A',finish:'knockout'});
  const input={challengeId:c.challengeId,requestId:'confirm',expectedRevision:c.revision,roundRevision:c.pendingRound.roundRevision};
  const a=await f.service.run('B','confirmRound',input);assert.deepEqual(await f.service.run('B','confirmRound',input),a);
  assert.equal(a.challenge.score.a,2);assert.equal(a.challenge.rounds.length,1);
  await assert.rejects(f.service.run('B','confirmRound',{...input,roundRevision:99}),/request-id-reused/);
  await assert.rejects(f.mutate('A','proposeRound',c,{winnerUid:'A',finish:'spin'}),/revision-conflict/);
});
test('unassigned reader, forged role, bad finish and unknown input fields reject',async()=>{
  const f=fixture(),c=await f.start();
  await assert.rejects(f.service.run('C','getChallenge',{challengeId:c.challengeId}),/participant-required/);
  await assert.rejects(f.mutate('A','proposeRound',c,{winnerUid:'C',finish:'spin'}),/invalid-round/);
  await assert.rejects(f.mutate('A','proposeRound',c,{winnerUid:'A',finish:'forged'}),/invalid-round/);
  await assert.rejects(f.mutate('A','start',c,{role:'super_admin'}),/invalid-input/);
});
test('role revocation blocks replay, opponent revocation blocks confirmation; cancellation remains possible',async()=>{
  const f=fixture();let c=await f.start();c=await f.mutate('A','proposeRound',c,{winnerUid:'A',finish:'spin'});
  f.data.get('hcActors/A').active=false;await assert.rejects(f.mutate('B','confirmRound',c,{roundRevision:c.pendingRound.roundRevision}),/opponent-unavailable/);
  c=await f.mutate('B','cancel',c);assert.equal(c.status,'cancelled');
  await assert.rejects(f.service.run('A','createChallenge',{requestId:'create'}),/account-unavailable/);
});
test('dispute returns pending round to review and preserves evidence; terminal cancellation is immutable',async()=>{
  const f=fixture();let c=await f.start();c=await f.mutate('B','proposeRound',c,{winnerUid:'A',finish:'spin'});c=await f.mutate('A','dispute',c);
  assert.equal(c.status,'score_review');assert.equal(c.pendingRound.winnerUid,'A');
  await assert.rejects(f.mutate('B','confirmRound',c,{roundRevision:c.pendingRound.roundRevision}),/round-confirmation-invalid/);
  const g=fixture(),cancelled=await g.mutate('A','cancel',await g.start());await assert.rejects(g.mutate('B','start',cancelled),/terminal-state/);
});
test('production projects and closed/invalid sandbox policy fail before mutation',async()=>{
  assert.throws(()=>createLifecycleService({db:{projectId:'bxh-arena'},auth:{app:{options:{projectId:'bxh-arena'}}}},{}),/sandbox-service-only/);
  const f=fixture();f.data.get('hcConfig/runtime').hc01Enabled=false;await assert.rejects(f.service.run('A','createChallenge',{requestId:'new'}),/closed/);
  f.data.get('hcConfig/runtime').hc01Enabled=true;f.data.get('hcConfig/runtime').hc01Rules.targetScore=0;await assert.rejects(f.service.run('A','createChallenge',{requestId:'new'}),/invalid-rules/);
});
test('transaction failure rolls back challenge, receipt and audit',async()=>{
  const f=fixture();f.data.set('hc01Audit/'+require('node:crypto').createHash('sha256').update(JSON.stringify(['A','createChallenge','create'])).digest('hex'),{existing:true});
  const before=structuredClone([...f.data]);await assert.rejects(f.service.run('A','createChallenge',{requestId:'create'}),/already-exists/);assert.deepEqual([...f.data],before);
});
test('domain rejects cross-environment and wrong result/round revisions',()=>{
  const c=domain.create({challengeId:'c',creatorUid:'A',rules:{version:'test',targetScore:4},now:1,expiresAt:100});
  assert.throws(()=>domain.transition({...c,environment:'production'},'B','accept',{expectedRevision:0},2),/environment-mismatch/);
  assert.throws(()=>domain.transition(c,'B','accept',{expectedRevision:4},2),/revision-conflict/);
});
test('QR payload round-trips only one-time pairing material and rejects malformed input',async()=>{
  const {pairingPayload,parsePairingPayload,renderPairingQr}=await import('../hunter-clash/hc01/pairing.mjs');
  const token='x'.repeat(43),payload=pairingPayload('hc01_test',token);
  assert.deepEqual(parsePairingPayload(payload),{challengeId:'hc01_test',pairingToken:token});
  for(const bad of [null,'https://example.com','bxh-hc01:../secret:'+token,payload+':extra'])assert.throws(()=>parsePairingPayload(bad),/invalid-pairing/);
  assert.throws(()=>pairingPayload(undefined,token),/invalid-pairing/);
  assert.throws(()=>renderPairingQr({},payload,null),/qr-renderer-unavailable/);
});
test('manual serial accepts normalized input, replays safely and never appears in read projection',async()=>{
  const f=fixture(),made=await f.service.run('A','createChallenge',{requestId:'serial'});
  assert.match(made.pairingCode,/^[2-9A-HJ-NP-Z]{4}$/);
  const input={requestId:'manual',expectedRevision:0,pairingCode:made.pairingCode.toLowerCase().replaceAll('-',' ')};
  const accepted=await f.service.run('B','acceptCode',input);assert.equal(accepted.challenge.status,'accepted');
  assert.deepEqual(await f.service.run('B','acceptCode',input),accepted);
  await assert.rejects(f.service.run('C','acceptCode',{...input,requestId:'other'}),/pairing-unavailable/);
  assert.equal('pairingCode'in (await f.service.run('A','getChallenge',{challengeId:made.challenge.challengeId})),false);
  assert.equal('pairingCodeHash'in accepted.challenge,false);
  assert.equal(JSON.stringify(f.data.get('hc01Challenges/'+made.challenge.challengeId)).includes(made.pairingCode.replaceAll('-','')),false);
});
test('QR and manual code compete for the same single-use challenge',async()=>{
  const f=fixture(),made=await f.service.run('A','createChallenge',{requestId:'race'});
  const outcomes=await Promise.allSettled([
    f.service.run('B','acceptCode',{requestId:'manual',expectedRevision:0,pairingCode:made.pairingCode}),
    f.service.run('C','accept',{requestId:'qr',expectedRevision:0,challengeId:made.challenge.challengeId,pairingToken:made.pairingToken})
  ]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.data.get('hc01Challenges/'+made.challenge.challengeId).participants.length,2);
});
test('manual serial rejects malformed, unknown, self-pairing and expired challenges',async()=>{
  const f=fixture(),made=await f.service.run('A','createChallenge',{requestId:'expire'});
  const input={requestId:'manual',expectedRevision:0,pairingCode:made.pairingCode};
  await assert.rejects(f.service.run('A','acceptCode',input),/pairing-unavailable/);
  for(const pairingCode of ['123456','0'.repeat(16),{},'x'.repeat(100)])await assert.rejects(f.service.run('B','acceptCode',{...input,pairingCode}),/pairing-unavailable/);
  f.setNow(made.challenge.expiresAt);await assert.rejects(f.service.run('B','acceptCode',input),/pairing-unavailable/);
  assert.deepEqual(f.data.get('hc01Challenges/'+made.challenge.challengeId).participants,['A']);
});

test('four-character codes skip active collisions and reuse expired entries without old QR consuming the new invite',async()=>{
  let sequence=0;
  const f=fixture({pairingCodeGenerator:()=>sequence++<8?'ABCD':sequence<=16?'ABCD':'EFGH'});
  const first=await f.service.run('A','createChallenge',{requestId:'first'});
  assert.equal(first.pairingCode,'ABCD');
  await assert.rejects(f.service.run('A','createChallenge',{requestId:'collision'}),/pairing-unavailable/);
  f.setNow(first.challenge.expiresAt);
  // A service with the same backing store exercises deterministic expired-code reuse.
  sequence=0;f.setNow(first.challenge.expiresAt);
  const second=await f.service.run('A','createChallenge',{requestId:'second'});
  assert.equal(second.pairingCode,'ABCD');
  await f.service.run('B','accept',{requestId:'oldqr',expectedRevision:0,challengeId:first.challenge.challengeId,pairingToken:first.pairingToken});
  const accepted=await f.service.run('B','acceptCode',{requestId:'newcode',expectedRevision:0,pairingCode:second.pairingCode});
  assert.equal(accepted.challenge.challengeId,second.challenge.challengeId);
});
test('short-code guesses are limited and receipt replay does not spend another attempt',async()=>{
  const f=fixture();
  for(let i=0;i<10;i++)await assert.rejects(f.service.run('B','acceptCode',{requestId:'guess'+i,expectedRevision:0,pairingCode:'ZZZZ'}),/pairing-unavailable/);
  await assert.rejects(f.service.run('B','acceptCode',{requestId:'blocked',expectedRevision:0,pairingCode:'ZZZZ'}),/pairing-rate-limited/);
  f.setNow(70000);
  const made=await f.service.run('A','createChallenge',{requestId:'new'});
  const input={requestId:'valid',expectedRevision:0,pairingCode:made.pairingCode};
  const accepted=await f.service.run('B','acceptCode',input);
  const count=f.data.get('hc01PairingAttempts/B').count;
  assert.deepEqual(await f.service.run('B','acceptCode',input),accepted);
  assert.equal(f.data.get('hc01PairingAttempts/B').count,count);
});

test('creator records both scores immediately, replay is idempotent and both confirm only the final result',async()=>{
  const f=fixture();let c=await f.start();
  await assert.rejects(f.mutate('B','recordRound',c,{winnerUid:'B',finish:'spin'}),/invalid-round/);
  const input={challengeId:c.challengeId,requestId:'direct-round',expectedRevision:c.revision,winnerUid:'B',finish:'knockout'};
  const result=await f.service.run('A','recordRound',input);assert.deepEqual(await f.service.run('A','recordRound',input),result);
  c=result.challenge;assert.equal(c.status,'in_progress');assert.equal(c.pendingRound,null);assert.equal(c.score.b,2);
  await assert.rejects(f.mutate('A','recordRound',{...c,revision:c.revision-1},{winnerUid:'B',finish:'spin'}),/revision-conflict/);
  c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'extreme'});
  c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'spin'});assert.deepEqual(c.score,{a:4,b:2});assert.equal(c.status,'final_pending');
  c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'final_pending');
  c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');assert.equal(c.ratingStatus,'not_awarded');
});
test('opponent can dispute an immediately recorded score during play',async()=>{
  const f=fixture();let c=await f.start();c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'spin'});
  c=await f.mutate('B','dispute',c);assert.equal(c.status,'score_review');assert.equal(c.rounds.length,1);
  await assert.rejects(f.mutate('B','recordRound',c,{winnerUid:'A',finish:'extreme'}),/invalid-round/);
  c=await f.mutate('A','resumeReview',c);assert.equal(c.status,'in_progress');
});


test('undo is creator-only, replay-safe and preserves the removed scoring evidence',async()=>{
  const f=fixture();let c=await f.start();
  await assert.rejects(f.mutate('A','undoRound',c),/undo-unavailable/);
  c=await f.mutate('A','recordRound',c,{winnerUid:'B',finish:'extreme'});
  await assert.rejects(f.mutate('B','undoRound',c),/undo-unavailable/);
  const input={challengeId:c.challengeId,requestId:'undo',expectedRevision:c.revision};
  const result=await f.service.run('A','undoRound',input);
  assert.deepEqual(await f.service.run('A','undoRound',input),result);
  c=result.challenge;assert.deepEqual(c.score,{a:0,b:0});assert.equal(c.rounds.length,0);
  assert.equal(c.corrections.length,1);assert.equal(c.corrections[0].round.finish,'extreme');
  await assert.rejects(f.mutate('A','undoRound',{...c,revision:c.revision-1}),/revision-conflict/);
  c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'spin'});
  assert.equal(c.rounds[0].number,1);assert.deepEqual(c.score,{a:1,b:0});
});

test('disputed final can be corrected and requires fresh confirmations of the new result',async()=>{
  const f=fixture();let c=await f.start();
  for(const finish of ['extreme','spin'])c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish});
  const oldResult=c.resultRevision;
  c=await f.mutate('A','confirmFinish',c,{resultRevision:oldResult});
  c=await f.mutate('B','dispute',c);
  assert.equal(c.status,'score_review');assert.deepEqual(c.finishConfirmedBy,[]);assert.equal(c.resultRevision,null);
  await assert.rejects(f.mutate('B','resumeReview',c),/review-unavailable/);
  await assert.rejects(f.mutate('A','confirmFinish',c,{resultRevision:oldResult}),/finish-confirmation-invalid/);
  c=await f.mutate('A','undoRound',c);assert.equal(c.status,'score_review');assert.deepEqual(c.score,{a:3,b:0});
  c=await f.mutate('A','recordRound',c,{winnerUid:'B',finish:'knockout'});
  c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'spin'});
  assert.equal(c.status,'score_review');
  c=await f.mutate('A','resumeReview',c);assert.equal(c.status,'final_pending');
  assert.notEqual(c.resultRevision,oldResult);
  await assert.rejects(f.mutate('B','confirmFinish',c,{resultRevision:oldResult}),/finish-confirmation-invalid/);
  c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});
  c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');
  await assert.rejects(f.mutate('A','undoRound',c),/terminal-state/);
});

test('undo pending legacy round never subtracts unconfirmed points',async()=>{
  const f=fixture();let c=await f.start();
  c=await f.mutate('B','proposeRound',c,{winnerUid:'B',finish:'burst'});
  c=await f.mutate('A','dispute',c);
  c=await f.mutate('A','undoRound',c);
  assert.equal(c.pendingRound,null);assert.deepEqual(c.score,{a:0,b:0});
  assert.equal(c.corrections[0].pending,true);
  c=await f.mutate('A','resumeReview',c);assert.equal(c.status,'in_progress');
});

test('undo final score clears an existing confirmation and reopens scoring',async()=>{
  const f=fixture();let c=await f.start();
  for(const finish of ['extreme','spin'])c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish});
  c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});
  c=await f.mutate('A','undoRound',c);
  assert.equal(c.status,'in_progress');assert.deepEqual(c.finishConfirmedBy,[]);
  assert.equal(c.resultRevision,null);assert.equal(c.winnerUid,undefined);assert.deepEqual(c.score,{a:3,b:0});
});

test('participant names persist for both phones and only the joining actor supplies their own name',async()=>{
  const f=fixture();f.data.get('hcActors/A').realName=' 黑爸 ';
  const created=await f.service.run('A','createChallenge',{requestId:'named',playerName:'其他名稱'});
  const joined=await f.mutate('B','accept',created.challenge,{pairingToken:created.pairingToken,playerName:' 小宇 '});
  assert.deepEqual(joined.participantNames,{A:'黑爸',B:'小宇'});
  for(const uid of ['A','B'])assert.deepEqual((await f.service.run(uid,'getChallenge',{challengeId:joined.challengeId})).challenge.participantNames,joined.participantNames);
  await assert.rejects(f.service.run('C','createChallenge',{requestId:'inject',participantNames:{A:'冒名'}}),/invalid-input/);
  await assert.rejects(f.service.run('C','createChallenge',{requestId:'long',playerName:'字'.repeat(41)}),/invalid-input/);
});

test('PK history records both perspectives only on final agreement and is idempotent',async()=>{
  const f=fixture();assert.equal((await f.service.run('A','getMyHistory',{})).history.total,0);
  let c=await f.start();c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'extreme'});c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'spin'});
  c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});
  assert.equal((await f.service.run('A','getMyHistory',{})).history.total,0);
  const input={challengeId:c.challengeId,requestId:'finish-history',expectedRevision:c.revision,resultRevision:c.resultRevision};
  await f.service.run('B','confirmFinish',input);await f.service.run('B','confirmFinish',input);
  const a=(await f.service.run('A','getMyHistory',{})).history,b=(await f.service.run('B','getMyHistory',{})).history;
  assert.deepEqual([a.total,a.wins,a.losses,b.total,b.wins,b.losses],[1,1,0,1,0,1]);
  assert.deepEqual([a.matches[0].score,a.matches[0].opponentScore,a.matches[0].opponentUid,b.matches[0].score,b.matches[0].opponentScore,b.matches[0].opponentUid],[4,0,'B',0,4,'A']);
  assert.equal((await f.service.run('C','getMyHistory',{})).history.total,0);
  await assert.rejects(f.service.run('C','getMyHistory',{uid:'A'}),/invalid-input/);
});
test('history keeps 50 recent matches while lifetime totals continue, and corrupt peer record rolls back all writes',async()=>{
  const f=fixture();let c=await f.start();c=await f.mutate('A','recordRound',c,{winnerUid:'B',finish:'extreme'});c=await f.mutate('A','recordRound',c,{winnerUid:'B',finish:'spin'});c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});
  f.data.set('hc01PlayerRecords/A',{environment:'sandbox',uid:'A',total:50,wins:50,losses:0,matches:Array.from({length:50},(_,i)=>({challengeId:'old_'+i}))});
  f.data.set('hc01PlayerRecords/B',{environment:'production',uid:'B'});
  await assert.rejects(f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision}),/history-unavailable/);
  assert.equal(f.data.get('hc01PlayerRecords/A').total,50);assert.equal(f.data.get('hc01Challenges/'+c.challengeId).status,'final_pending');
  f.data.delete('hc01PlayerRecords/B');await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});
  const a=(await f.service.run('A','getMyHistory',{})).history;assert.deepEqual([a.total,a.wins,a.losses,a.matches.length],[51,50,1,50]);assert.equal(a.matches[0].challengeId,c.challengeId);assert.equal(a.matches.at(-1).challengeId,'old_48');
});

async function seriesFixture(matchCount){
  const f=fixture(),made=await f.service.run('A','createChallenge',{requestId:'series',matchCount,playerName:'黑爸'});
  let c=await f.mutate('B','accept',made.challenge,{pairingToken:made.pairingToken,playerName:'小宇'});c=await f.mutate('A','start',c);c=await f.mutate('B','start',c);
  return {f,c,async score(c,winnerUid){c=await f.mutate('A','recordRound',c,{winnerUid,finish:'extreme'});return f.mutate('A','recordRound',c,{winnerUid,finish:'spin'});}};
}
test('three-game room needs pairing/start once and records each game once after whole-series agreement',async()=>{
  const {f,score,c:initial}=await seriesFixture(3);let c=await score(initial,'A');assert.equal(c.status,'game_pending');
  await assert.rejects(f.mutate('B','nextGame',c),/invalid-state/);await assert.rejects(f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision}),/finish-confirmation-invalid/);
  const input={challengeId:c.challengeId,requestId:'next-once',expectedRevision:c.revision};c=(await f.service.run('A','nextGame',input)).challenge;
  assert.deepEqual((await f.service.run('A','nextGame',input)).challenge,c);assert.deepEqual(c.score,{a:0,b:0});assert.equal(c.games.length,1);assert.equal(c.gameNumber,2);assert.deepEqual(c.participants,['A','B']);
  c=await score(c,'B');c=await f.mutate('A','nextGame',c);c=await score(c,'A');assert.equal(c.status,'final_pending');
  assert.equal((await f.service.run('A','getMyHistory',{})).history.total,0);
  c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');
  const a=(await f.service.run('A','getMyHistory',{})).history,b=(await f.service.run('B','getMyHistory',{})).history;
  assert.deepEqual([a.total,a.wins,a.losses,b.total,b.wins,b.losses],[3,2,1,3,1,2]);assert.deepEqual(a.matches.map(m=>m.gameNumber),[3,2,1]);assert.deepEqual(a.matches.map(m=>m.score),[4,0,4]);
});
test('practice ends on demand, review preserves previous games and clears final confirmation',async()=>{
  const {f,score,c:initial}=await seriesFixture(0);let c=await score(initial,'B');c=await f.mutate('A','nextGame',c);
  await assert.rejects(f.mutate('A','endSession',c),/invalid-state/);c=await score(c,'A');c=await f.mutate('A','endSession',c);c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});
  c=await f.mutate('B','dispute',c);assert.equal(c.games.length,1);c=await f.mutate('A','undoRound',c);assert.equal(c.score.a,3);c=await f.mutate('A','recordRound',c,{winnerUid:'A',finish:'knockout'});c=await f.mutate('A','resumeReview',c);assert.equal(c.status,'final_pending');assert.deepEqual(c.finishConfirmedBy,[]);
  c=await f.mutate('B','confirmFinish',c,{resultRevision:c.resultRevision});c=await f.mutate('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');const a=(await f.service.run('A','getMyHistory',{})).history;assert.deepEqual([a.total,a.wins,a.losses],[2,1,1]);assert.equal(a.matches[0].score,5);
});
test('room counts are bounded, default one remains compatible and practice caps at 100 games',async()=>{
  const f=fixture();for(const matchCount of [-1,101,1.5,'2',null])await assert.rejects(f.service.run('A','createChallenge',{requestId:'invalid_'+String(matchCount).replace(/[^a-z0-9]/gi,'_'),matchCount}),/invalid-input/);
  const made=await f.service.run('A','createChallenge',{requestId:'default-one'});assert.equal(made.challenge.matchCount,1);
  const {c:initial}=await seriesFixture(0);initial.gameNumber=100;let c=domain.transition(initial,'A','recordRound',{expectedRevision:initial.revision,winnerUid:'A',finish:'extreme'},10000);c=domain.transition(c,'A','recordRound',{expectedRevision:c.revision,winnerUid:'A',finish:'spin'},10000);assert.equal(c.status,'final_pending');assert.throws(()=>domain.transition(c,'A','nextGame',{expectedRevision:c.revision},10000),/invalid-state/);
});
