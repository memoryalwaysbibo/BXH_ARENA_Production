'use strict';
const {createHash,randomBytes,randomInt}=require('node:crypto');
const domain=require('./domain.cjs');
const {assertSandboxRuntime}=require('../server/runtime-boundary.cjs');
const CODE_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode=()=>Array.from({length:4},()=>CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>digest(JSON.stringify(value));
const denied=reason=>{throw Error(reason);};
const displayName=(actor,input)=>[actor.realName,actor.displayName,actor.gameId,input.playerName].find(v=>typeof v==='string'&&v.trim()&&v.trim().length<=40&&!/[\u0000-\u001f\u007f]/.test(v))?.trim()||'未設定名稱';
// No deployment export. A trusted adapter must supply Auth, Firestore and clock.
function createLifecycleService({db,auth,clock=Date.now},env=process.env,options={}){
  assertSandboxRuntime(db,auth,env,options.expectedCloudProject);
  const doc=(collection,id)=>db.collection(collection).doc(id);
  const eligible=a=>a?.active===true&&a.hc01Allowed===true&&a.deleted!==true&&
    !['frozen','disabled','deleted'].includes(a.accountStatus)&&['player','staff','admin','super_admin'].includes(a.role);
  async function run(token,operation,input){
    const createOp=operation==='createChallenge',historyOp=operation==='getMyHistory',readOp=operation==='getChallenge'||historyOp,codeOp=operation==='acceptCode';
    if(![...domain.OPERATIONS,'createChallenge','getChallenge','getMyHistory','acceptCode'].includes(operation))denied('invalid-operation');
    if(typeof token!=='string'||!token)denied('unauthenticated');
    const {uid}=await auth.verifyIdToken(token,true);domain.identifier(uid);
    domain.keys(input,createOp?['requestId','playerName']:historyOp?[]:readOp?['challengeId']:codeOp?['pairingCode','requestId','expectedRevision','playerName']:
      ['challengeId','requestId','expectedRevision',...(operation==='accept'?['pairingToken','playerName']:['proposeRound','recordRound'].includes(operation)?['winnerUid','finish']:operation==='confirmRound'?['roundRevision']:operation==='confirmFinish'?['resultRevision']:[])]);
    if(Object.hasOwn(input,'playerName')&&(typeof input.playerName!=='string'||!input.playerName.trim()||input.playerName.trim().length>40||/[\u0000-\u001f\u007f]/.test(input.playerName)))denied('invalid-input');
    if(!readOp)domain.identifier(input.requestId);
    if(!createOp&&!codeOp&&!historyOp)domain.identifier(input.challengeId);
    const suppliedCode=codeOp&&typeof input.pairingCode==='string'&&input.pairingCode.length<=40?input.pairingCode.replace(/[\s-]/g,'').toUpperCase():null;
    if(codeOp&&!/^(?:[2-9A-HJ-NP-Z]{4}|[A-F0-9]{16})$/.test(suppliedCode||''))denied('pairing-unavailable');
    let challengeId=codeOp?null:createOp?'hc01_'+hash([uid,input.requestId]).slice(0,40):input.challengeId;
    let challengeRef=challengeId?doc('hc01Challenges',challengeId):null;
    const receiptRef=readOp?null:doc('hc01Receipts',hash([uid,operation,input.requestId]));
    const fingerprint=hash(input);
    // Generated once outside transaction retries; plaintext is never in challenge/public view.
    const pairingToken=createOp?randomBytes(32).toString('base64url'):null;
    const candidates=createOp?Array.from({length:8},()=> (options.pairingCodeGenerator||newCode)()):[];
    if(candidates.some(c=>!/^[2-9A-HJ-NP-Z]{4}$/.test(c)))denied('invalid-pairing-code-generator');
    let pairingCode=suppliedCode,codeRef=codeOp?doc('hc01PairingCodes',digest(suppliedCode)):null;
    // Short codes are authenticated, allowlisted and limited to ten attempts per minute.
    if(codeOp)await db.runTransaction(async tx=>{
      const limitRef=doc('hc01PairingAttempts',uid);
      const [actor,config,receipt,limit]=(await tx.getAll(doc('hcActors',uid),doc('hcConfig','runtime'),receiptRef,limitRef)).map(s=>s.data());
      if(!eligible(actor))denied('account-unavailable');
      if(config?.enabled!==true||config.environment!=='sandbox'||config.hc01Enabled!==true)denied('closed');
      if(receipt)return;
      const now=clock(),sameWindow=limit&&now>=limit.windowStart&&now-limit.windowStart<60000;
      if(sameWindow&&limit.count>=10)denied('pairing-rate-limited');
      tx.set(limitRef,{environment:'sandbox',windowStart:sameWindow?limit.windowStart:now,count:sameWindow?limit.count+1:1});
    });
    return db.runTransaction(async tx=>{
      const refs=[doc('hcActors',uid),doc('hcConfig','runtime')];if(receiptRef)refs.push(receiptRef);
      const [actor,config,receipt]=(await tx.getAll(...refs)).map(s=>s.data());
      if(!eligible(actor))denied('account-unavailable');
      if(config?.enabled!==true||config.environment!=='sandbox'||config.hc01Enabled!==true)denied('closed');
      if(receipt){if(receipt.fingerprint!==fingerprint)denied('request-id-reused');return receipt.outcome;}
      const now=clock();
      if(historyOp){
        const [record]=await tx.getAll(doc('hc01PlayerRecords',uid));
        const history=record.data()||{environment:'sandbox',uid,total:0,wins:0,losses:0,matches:[]};
        if(history.environment!=='sandbox'||history.uid!==uid)denied('history-unavailable');
        return {history:structuredClone(history)};
      }
      if(createOp){
        const candidateRefs=candidates.map(c=>doc('hc01PairingCodes',digest(c)));
        const entries=(await tx.getAll(...candidateRefs)).map(s=>s.data());
        const index=entries.findIndex(e=>!e||(e.environment==='sandbox'&&Number.isSafeInteger(e.expiresAt)&&e.expiresAt<=now));
        if(index<0)denied('pairing-unavailable');
        pairingCode=candidates[index];codeRef=candidateRefs[index];
      }
      if(codeOp){
        const [codeSnap]=await tx.getAll(codeRef);const entry=codeSnap.data();
        if(codeOp){
          if(!entry||entry.environment!=='sandbox'||entry.used!==false)denied('pairing-unavailable');
          domain.identifier(entry.challengeId);challengeId=entry.challengeId;challengeRef=doc('hc01Challenges',challengeId);
        }
      }
      const [challengeSnap]=await tx.getAll(challengeRef);const current=challengeSnap.data();
      let next,outcome,consumeCodeRef=null;
      if(!createOp&&(operation==='accept'||codeOp)&&current?.pairingCodeHash){
        const ref=doc('hc01PairingCodes',current.pairingCodeHash);
        const [snapshot]=await tx.getAll(ref);
        if(snapshot.data()?.challengeId===challengeId)consumeCodeRef=ref;
      }
      if(createOp){
        if(current)denied('challenge-already-exists');
        // Sandbox policy is configured explicitly, not a claimed final product rule.
        const rules=domain.policy(config.hc01Rules);
        const ttl=config.hc01PairingTtlMs;
        if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>300000)denied('invalid-pairing-policy');
        next=domain.create({challengeId,creatorUid:uid,rules,now,expiresAt:now+ttl});
        next.participantNames={[uid]:displayName(actor,input)};
        next.pairingTokenHash=digest(pairingToken);next.pairingCodeHash=digest(pairingCode);
        outcome={challenge:view(next),pairingToken,pairingCode};
      }else{
        if(!current||current.environment!=='sandbox'||current.challengeId!==challengeId)denied('challenge-unavailable');
        if(codeOp&&now>=current.expiresAt)denied('pairing-unavailable');
        if(operation==='accept'||codeOp){
          if(codeOp){if(digest(suppliedCode)!==current.pairingCodeHash)denied('pairing-unavailable');}
          else
          if(typeof input.pairingToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.pairingToken)||digest(input.pairingToken)!==current.pairingTokenHash)denied('pairing-unavailable');
        }else if(!current.participants.includes(uid))denied('participant-required');
        if(readOp)return {challenge:view(current),expired:['proposed','accepted'].includes(current.status)&&now>=current.expiresAt};
        if(!['cancel','reject'].includes(operation)){
          const others=current.participants.filter(v=>v!==uid);
          if(others.length){const peers=await tx.getAll(...others.map(v=>doc('hcActors',v)));if(peers.some(s=>!eligible(s.data())))denied('opponent-unavailable');}
        }
        const command={...input};delete command.challengeId;delete command.requestId;delete command.pairingToken;delete command.pairingCode;delete command.playerName;
        next=domain.transition(current,uid,codeOp?'accept':operation,command,now);
        if(operation==='accept'||codeOp){next.participantNames={...(next.participantNames||{}),[uid]:displayName(actor,input)};delete next.pairingTokenHash;delete next.pairingCodeHash;}
        outcome={challenge:view(next)};
      }
      // Final confirmation commits the result and both player summaries atomically.
      // Receipt replay returns before this block, so retries cannot add a second win.
      if(next.status==='completed'&&current?.status!=='completed'){
        const records=await tx.getAll(...next.participants.map(player=>doc('hc01PlayerRecords',player)));
        for(const [index,player]of next.participants.entries()){
          const prior=records[index].data()||{environment:'sandbox',uid:player,total:0,wins:0,losses:0,matches:[]};
          if(prior.environment!=='sandbox'||prior.uid!==player||!Number.isSafeInteger(prior.total)||prior.total<0||!Number.isSafeInteger(prior.wins)||!Number.isSafeInteger(prior.losses)||prior.wins<0||prior.losses<0||prior.wins+prior.losses!==prior.total||!Array.isArray(prior.matches)||prior.total>=Number.MAX_SAFE_INTEGER)denied('history-unavailable');
          const opponentUid=next.participants[1-index],won=next.winnerUid===player;
          const match={challengeId:next.challengeId,playerName:next.participantNames?.[player]||'未設定名稱',opponentName:next.participantNames?.[opponentUid]||'未設定名稱',opponentUid,score:next.score[index===0?'a':'b'],opponentScore:next.score[index===0?'b':'a'],won,completedAt:next.completedAt};
          tx.set(doc('hc01PlayerRecords',player),{environment:'sandbox',uid:player,total:prior.total+1,wins:prior.wins+(won?1:0),losses:prior.losses+(won?0:1),updatedAt:next.completedAt,matches:[match,...prior.matches].slice(0,50)});
        }
      }
      if(createOp)tx.set(codeRef,{environment:'sandbox',challengeId,expiresAt:next.expiresAt,used:false});
      else if(consumeCodeRef)tx.set(consumeCodeRef,{environment:'sandbox',challengeId,expiresAt:current.expiresAt,used:true});
      if(createOp)tx.create(challengeRef,next);else tx.set(challengeRef,next);
      tx.create(receiptRef,{schemaVersion:1,environment:'sandbox',actorUid:uid,operation,fingerprint,outcome,createdAt:now});
      tx.create(doc('hc01Audit',hash([uid,operation,input.requestId])),{environment:'sandbox',challengeId,operation,actorUid:uid,revision:next.revision,status:next.status,at:now});
      return outcome;
    });
  }
  return Object.freeze({run});
}
function view(c){
  const allowed=['schemaVersion','environment','challengeId','participants','participantNames','rules','status','revision','createdAt','expiresAt','ready','rounds','pendingRound','score','finishConfirmedBy','resultRevision','winnerUid','completedAt','certificationSource','ratingStatus','disputedBy','disputedAt','corrections'];
  return Object.fromEntries(allowed.filter(k=>Object.hasOwn(c,k)).map(k=>[k,structuredClone(c[k])]));
}
module.exports={createLifecycleService,view};
