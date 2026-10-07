'use strict';
const {createHash,randomBytes}=require('node:crypto');
const domain=require('./domain.cjs');
const {assertSandboxRuntime}=require('../server/runtime-boundary.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>digest(JSON.stringify(value));
const denied=reason=>{throw Error(reason);};
// No deployment export. A trusted adapter must supply Auth, Firestore and clock.
function createLifecycleService({db,auth,clock=Date.now},env=process.env,options={}){
  assertSandboxRuntime(db,auth,env,options.expectedCloudProject);
  const doc=(collection,id)=>db.collection(collection).doc(id);
  const eligible=a=>a?.active===true&&a.hc01Allowed===true&&a.deleted!==true&&
    !['frozen','disabled','deleted'].includes(a.accountStatus)&&['player','staff','admin','super_admin'].includes(a.role);
  async function run(token,operation,input){
    const createOp=operation==='createChallenge',readOp=operation==='getChallenge';
    if(![...domain.OPERATIONS,'createChallenge','getChallenge'].includes(operation))denied('invalid-operation');
    if(typeof token!=='string'||!token)denied('unauthenticated');
    const {uid}=await auth.verifyIdToken(token,true);domain.identifier(uid);
    domain.keys(input,createOp?['requestId']:readOp?['challengeId']:
      ['challengeId','requestId','expectedRevision',...(operation==='accept'?['pairingToken']:operation==='proposeRound'?['winnerUid','finish']:operation==='confirmRound'?['roundRevision']:operation==='confirmFinish'?['resultRevision']:[])]);
    if(!readOp)domain.identifier(input.requestId);
    if(!createOp)domain.identifier(input.challengeId);
    const challengeId=createOp?'hc01_'+hash([uid,input.requestId]).slice(0,40):input.challengeId;
    const challengeRef=doc('hc01Challenges',challengeId);
    const receiptRef=readOp?null:doc('hc01Receipts',hash([uid,operation,input.requestId]));
    const fingerprint=hash(input);
    // Generated once outside transaction retries; plaintext is never in challenge/public view.
    const pairingToken=createOp?randomBytes(32).toString('base64url'):null;
    return db.runTransaction(async tx=>{
      const refs=[doc('hcActors',uid),doc('hcConfig','runtime'),challengeRef];if(receiptRef)refs.push(receiptRef);
      const snaps=await tx.getAll(...refs);
      const [actor,config,current,receipt]=snaps.map(s=>s.data());
      if(!eligible(actor))denied('account-unavailable');
      if(config?.enabled!==true||config.environment!=='sandbox'||config.hc01Enabled!==true)denied('closed');
      if(receipt){if(receipt.fingerprint!==fingerprint)denied('request-id-reused');return receipt.outcome;}
      const now=clock();let next,outcome;
      if(createOp){
        if(current)denied('challenge-already-exists');
        // Sandbox policy is configured explicitly, not a claimed final product rule.
        const rules=domain.policy(config.hc01Rules);
        const ttl=config.hc01PairingTtlMs;
        if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>300000)denied('invalid-pairing-policy');
        next=domain.create({challengeId,creatorUid:uid,rules,now,expiresAt:now+ttl});
        next.pairingTokenHash=digest(pairingToken);
        outcome={challenge:view(next),pairingToken};
      }else{
        if(!current||current.environment!=='sandbox'||current.challengeId!==challengeId)denied('challenge-unavailable');
        if(operation==='accept'){
          if(typeof input.pairingToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.pairingToken)||digest(input.pairingToken)!==current.pairingTokenHash)denied('pairing-unavailable');
        }else if(!current.participants.includes(uid))denied('participant-required');
        if(readOp)return {challenge:view(current),expired:['proposed','accepted'].includes(current.status)&&now>=current.expiresAt};
        if(!['cancel','reject'].includes(operation)){
          const others=current.participants.filter(v=>v!==uid);
          if(others.length){const peers=await tx.getAll(...others.map(v=>doc('hcActors',v)));if(peers.some(s=>!eligible(s.data())))denied('opponent-unavailable');}
        }
        const command={...input};delete command.challengeId;delete command.requestId;delete command.pairingToken;
        next=domain.transition(current,uid,operation,command,now);
        if(operation==='accept')delete next.pairingTokenHash;
        outcome={challenge:view(next)};
      }
      if(createOp)tx.create(challengeRef,next);else tx.set(challengeRef,next);
      tx.create(receiptRef,{schemaVersion:1,environment:'sandbox',actorUid:uid,operation,fingerprint,outcome,createdAt:now});
      tx.create(doc('hc01Audit',hash([uid,operation,input.requestId])),{environment:'sandbox',challengeId,operation,actorUid:uid,revision:next.revision,status:next.status,at:now});
      return outcome;
    });
  }
  return Object.freeze({run});
}
function view(c){
  const allowed=['schemaVersion','environment','challengeId','participants','rules','status','revision','createdAt','expiresAt','ready','rounds','pendingRound','score','finishConfirmedBy','resultRevision','winnerUid','completedAt','certificationSource','ratingStatus','disputedBy','disputedAt'];
  return Object.fromEntries(allowed.filter(k=>Object.hasOwn(c,k)).map(k=>[k,structuredClone(c[k])]));
}
module.exports={createLifecycleService,view};
