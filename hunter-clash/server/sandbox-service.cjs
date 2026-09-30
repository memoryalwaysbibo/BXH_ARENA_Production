'use strict';
// Sandbox-only transaction foundation. No Functions export or production adapter.
const { createHash } = require('node:crypto');
const { assertIsolated, PROJECT } = require('../emulator/preflight.cjs');
const { assertTransition, assertSettlement } = require('../contracts.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw Error('invalid-id');
  return value;
}
function request(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !keys.includes(key))) throw Error('invalid-request');
  id(input.challengeId); id(input.requestId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('invalid-revision');
}
function active(actor) {
  return actor?.active === true && actor.deleted !== true &&
    !['disabled','deleted','frozen'].includes(actor.accountStatus) &&
    ['staff','admin','super_admin'].includes(actor.role);
}
function validScore(score) {
  return score && Object.keys(score).every(key=>['a','b'].includes(key)) &&
    [score.a,score.b].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=100) && score.a!==score.b;
}
function createSandboxService({ db, auth, serverTimestamp }, env = process.env) {
  assertIsolated(env);
  if (env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180' ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098' ||
      db.projectId !== PROJECT || auth.app.options.projectId !== PROJECT)
    throw Error('sandbox-service-only');
  const ref = (name, value) => db.collection(name).doc(value);
  async function transact(token, input, operation, execute) {
    if (typeof token !== 'string' || !token) throw Error('unauthenticated');
    const verified = await auth.verifyIdToken(token, true);
    const uid = verified.uid;
    const requestRef = ref('hcRequests',hash([uid,operation,input.requestId]));
    const fingerprint = hash(input);
    return db.runTransaction(async tx => {
      const [actorSnap, configSnap, receiptSnap] = await tx.getAll(
        ref('hcActors',uid), ref('hcConfig','runtime'), requestRef);
      const actor = actorSnap.data();
      if (!active(actor)) throw Error('account-unavailable');
      const config = configSnap.data();
      if (!config || config.enabled !== true || config.environment !== 'sandbox') throw Error('closed');
      if (receiptSnap.exists) {
        if (receiptSnap.data().fingerprint !== fingerprint) throw Error('request-id-reused');
        return receiptSnap.data().outcome;
      }
      const outcome = await execute(tx,uid,actor);
      tx.create(requestRef,{schemaVersion:1,environment:'sandbox',operation,actorUid:uid,
        fingerprint,outcome,createdAt:serverTimestamp()});
      return outcome;
    });
  }
  async function submit(token, input) {
    request(input,['challengeId','requestId','expectedRevision','winnerUid','score']);
    if (!validScore(input.score) || typeof input.winnerUid !== 'string') throw Error('invalid-score');
    const data = {challengeId:input.challengeId,requestId:input.requestId,expectedRevision:input.expectedRevision,
      winnerUid:input.winnerUid,score:{a:input.score.a,b:input.score.b}};
    return transact(token,data,'submit',async (tx,uid) => {
      const challengeRef=ref('hcChallenges',data.challengeId);
      const challenge=(await tx.get(challengeRef)).data();
      if (!challenge || challenge.environment !== 'sandbox' || !Array.isArray(challenge.participants) ||
          challenge.participants.length !== 2 || new Set(challenge.participants).size !== 2 ||
          !challenge.participants.includes(uid)) throw Error('challenge-unavailable');
      const winner = challenge.participants[data.score.a > data.score.b ? 0 : 1];
      if (data.winnerUid !== winner) throw Error('winner-mismatch');
      const revision=assertTransition(challenge.status,'submitted',challenge.revision,data.expectedRevision);
      const resultRef=ref('hcResults',data.challengeId);
      if ((await tx.get(resultRef)).exists) throw Error('result-already-exists');
      tx.create(resultRef,{schemaVersion:1,environment:'sandbox',challengeId:data.challengeId,
        resultRevision:revision,participants:challenge.participants,winnerUid:winner,score:data.score,
        status:'submitted',verificationStatus:'pending',riskStatus:'hold',submittedBy:uid,createdAt:serverTimestamp()});
      tx.update(challengeRef,{status:'submitted',revision,resultRevision:revision});
      return {challengeId:data.challengeId,revision,status:'submitted'};
    });
  }
  async function settle(token,input) {
    request(input,['challengeId','requestId','expectedRevision','resultRevision']);
    if (!Number.isSafeInteger(input.resultRevision) || input.resultRevision < 0) throw Error('invalid-revision');
    const data={challengeId:input.challengeId,requestId:input.requestId,
      expectedRevision:input.expectedRevision,resultRevision:input.resultRevision};
    return transact(token,data,'settle',async (tx,uid,actor) => {
      if (!['admin','super_admin'].includes(actor.role)) throw Error('settlement-forbidden');
      const challengeRef=ref('hcChallenges',data.challengeId), resultRef=ref('hcResults',data.challengeId);
      const ledgerRef=ref('hcSettlementLedger',hash(['sandbox',data.challengeId,data.resultRevision,'sandbox_record']));
      const [challengeSnap,resultSnap,ledgerSnap]=await tx.getAll(challengeRef,resultRef,ledgerRef);
      const c=challengeSnap.data(), r=resultSnap.data();
      if (!c || !r || c.environment !== 'sandbox' || r.environment !== 'sandbox' ||
          c.settlementActorUid !== uid || c.challengeId !== data.challengeId || r.challengeId !== data.challengeId ||
          !Array.isArray(c.participants) || c.participants.length !== 2 || new Set(c.participants).size !== 2 ||
          c.participants.includes(uid) || JSON.stringify(r.participants) !== JSON.stringify(c.participants) ||
          !validScore(r.score) || r.winnerUid !== c.participants[r.score.a > r.score.b ? 0 : 1] ||
          r.resultRevision !== data.resultRevision ||
          c.resultRevision !== data.resultRevision) throw Error('result-unavailable');
      const resultHash=hash([data.challengeId,r.resultRevision,r.participants,r.winnerUid,r.score,
        r.verifiedBy,r.verificationRevision,r.riskRevision]);
      if (ledgerSnap.exists) {
        const ledger=ledgerSnap.data();
        if (ledger.resultHash !== resultHash || ledger.fromRevision !== data.expectedRevision ||
            r.status !== 'settled' || c.status !== 'settled') throw Error('settled-result-conflict');
        return ledger.outcome;
      }
      assertSettlement(r,'sandbox');
      if (r.verificationRevision !== r.resultRevision || r.riskRevision !== r.resultRevision ||
          typeof r.verifiedBy !== 'string' || c.verificationActorUid !== r.verifiedBy ||
          c.participants.includes(r.verifiedBy)) throw Error('invalid-verification');
      const witness=(await tx.get(ref('hcActors',r.verifiedBy))).data();
      if (!active(witness)) throw Error('witness-unavailable');
      const revision=assertTransition(c.status,'settled',c.revision,data.expectedRevision);
      const statRefs=c.participants.map(v=>ref('hcSandboxStats',hash(v)));
      const stats=await tx.getAll(...statRefs);
      stats.forEach((s,i)=>{
        if (s.exists && (![s.data().matches,s.data().wins].every(v=>Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER) ||
            s.data().wins > s.data().matches || s.data().environment !== 'sandbox' || s.data().uid !== c.participants[i]))
          throw Error('invalid-sandbox-stats');
      });
      const outcome={challengeId:data.challengeId,revision,status:'settled'};
      tx.create(ledgerRef,{schemaVersion:1,environment:'sandbox',effectType:'sandbox_record',resultHash,
        fromRevision:data.expectedRevision,outcome,createdAt:serverTimestamp()});
      tx.create(ref('hcAuditEvents',ledgerRef.id),{operation:'settle',environment:'sandbox',
        challengeId:data.challengeId,actorUid:uid,createdAt:serverTimestamp()});
      stats.forEach((s,i)=>tx.set(statRefs[i],{environment:'sandbox',uid:c.participants[i],
        matches:(s.data()?.matches||0)+1,wins:(s.data()?.wins||0)+(c.participants[i]===r.winnerUid?1:0)}));
      tx.update(challengeRef,{status:'settled',revision});
      tx.update(resultRef,{status:'settled',settledAt:serverTimestamp()});
      return outcome;
    });
  }
  return Object.freeze({submit,settle});
}
module.exports={createSandboxService};
