'use strict';
const {createHash,randomBytes,randomInt}=require('node:crypto');
const domain=require('./domain.cjs'),adapter=require('./adapter.js'),xp=require('./practice-xp.cjs'),ach=require('./achievements.js');
const ENV=adapter.ENV,hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=s=>{throw Error(s);},alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const code=()=>Array.from({length:4},()=>alphabet[randomInt(alphabet.length)]).join('');
const name=p=>[p.displayName,p.nickname,p.gameId,p.realName].find(v=>typeof v==='string'&&v.trim())?.trim().slice(0,40)||'未設定名稱';
const eligible=p=>p?.active===true&&!p.isTestAccount&&['player','staff','admin','super_admin'].includes(p.role)&&!['frozen','disabled','deleted'].includes(p.accountStatus);
const view=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['pairingTokenHash','pairingCodeHash'].includes(k)));
function createService({db,auth,clock=Date.now,codeGenerator=code}){
 if(!['bxh-arena','demo-arena-pk'].includes(db.projectId)||auth.app?.options?.projectId!==db.projectId)fail('project-mismatch');
 const ref=(collection,id)=>db.collection(collection).doc(id),ledger=uid=>db.collection('arenaPKPlayers').doc(uid).collection('matches');
 const admit=(profile,config,uid)=>{if(!eligible(profile))fail('account-unavailable');if(config.enabled!==true||config.environment!==ENV)fail('closed');};
 async function run(token,operation,input={}){
  if(typeof token!=='string'||!token)fail('unauthenticated');let decoded;try{decoded=await auth.verifyIdToken(token,true);}catch{fail('unauthenticated');}const uid=domain.identifier(decoded.uid);
  const read=['getChallenge','getMyHistory'].includes(operation),create=operation==='createChallenge',accept=operation==='acceptCode'||operation==='accept',revoke=operation==='revokeChallenge';
  if(![...domain.OPERATIONS,'createChallenge','acceptCode','getChallenge','getMyHistory','revokeChallenge'].includes(operation))fail('invalid-operation');
  domain.keys(input,operation==='getMyHistory'?['cursor','generation','limit']:create?['requestId','matchCount']:operation==='acceptCode'?['requestId','expectedRevision','pairingCode']:['challengeId',...(!read?['requestId','expectedRevision']:[]),...(operation==='accept'?['pairingToken']:['recordRound','proposeRound'].includes(operation)?['winnerUid','finish']:operation==='confirmRound'?['roundRevision']:operation==='confirmFinish'?['resultRevision']:revoke?['reason']:[])]);
  if(!read)domain.identifier(input.requestId);
  if(!create&&operation!=='acceptCode'&&operation!=='getMyHistory')domain.identifier(input.challengeId);
  if(revoke&&(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>200))fail('invalid-input');
  const suppliedCode=operation==='acceptCode'&&typeof input.pairingCode==='string'?input.pairingCode.trim().toUpperCase():null;
  if(operation==='acceptCode'&&!/^[2-9A-HJ-NP-Z]{4}$/.test(suppliedCode||''))fail('pairing-unavailable');
  const receiptRef=read?null:ref('arenaPKReceipts',hash([uid,operation,input.requestId])),fingerprint=hash(input),tokenValue=create?randomBytes(32).toString('base64url'):null,candidates=create?Array.from({length:8},codeGenerator):[];
  if(candidates.some(c=>!/^[2-9A-HJ-NP-Z]{4}$/.test(c)))fail('invalid-code');
  if(operation==='acceptCode')await db.runTransaction(async tx=>{
    const [p,c,r,a]=(await tx.getAll(ref('users',uid),ref('systemSettings','hunterClash'),receiptRef,ref('arenaPKAttempts',uid))).map(s=>s.data());admit(p,c,uid);if(r)return;
    const now=clock(),same=a&&now>=a.start&&now-a.start<60000;if(same&&a.count>=10)fail('pairing-rate-limited');tx.set(ref('arenaPKAttempts',uid),{start:same?a.start:now,count:same?a.count+1:1});
  });
  return db.runTransaction(async tx=>{
    const [profile,config,receipt]=(await tx.getAll(ref('users',uid),ref('systemSettings','hunterClash'),...(receiptRef?[receiptRef]:[]))).map(s=>s.data());
    if(revoke){if(!eligible(profile)||profile.role!=='super_admin')fail('admin-required');if(config?.environment!==ENV)fail('closed');}
    else admit(profile,config,uid);
    if(receipt){if(receipt.fingerprint!==fingerprint)fail('request-id-reused');return receipt.outcome;}
    const now=clock();
    if(operation==='getMyHistory'){
      const limit=input.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.cursor!=null&&!/^[A-Za-z0-9_-]{1,160}$/.test(input.cursor))fail('invalid-input');
      const day=xp.dayKey(now);const [m,d]=await tx.getAll(ref('arenaPKPlayers',uid),ref('arenaPKPlayers',uid).collection('xpDays').doc(day));const meta=m.data()||{uid,total:0,wins:0,losses:0,generation:0,environment:ENV};
      if(meta.environment!==ENV||meta.uid!==uid)fail('history-unavailable');
      if(input.cursor&&(input.generation!==meta.generation))fail('history-changed');
      let query=ledger(uid).orderBy('__name__').limit(limit+1);if(input.cursor)query=query.startAfter(input.cursor);
      const page=await tx.get(query),docs=page.docs.slice(0,limit),rows=docs.map(d=>d.data());
      return {history:{...meta,practiceXp:xp.summary(meta,xp.daily(d.data(),uid,day),config.practiceXpEnabled!==false),rows,nextCursor:page.docs.length>limit?docs.at(-1).id:null}};
    }
    let challengeId=create?'pk_'+hash([uid,input.requestId]).slice(0,40):input.challengeId,codeRef=null,pairingCode;
    if(create){const refs=candidates.map(c=>ref('arenaPKCodes',hash(c))),codes=(await tx.getAll(...refs)).map(s=>s.data()),i=codes.findIndex(c=>!c||c.expiresAt<=now);if(i<0)fail('pairing-unavailable');codeRef=refs[i];pairingCode=candidates[i];}
    if(operation==='acceptCode'){codeRef=ref('arenaPKCodes',hash(suppliedCode));const [s]=await tx.getAll(codeRef),c=s.data();if(!c||c.environment!==ENV||c.used||c.expiresAt<=now)fail('pairing-unavailable');challengeId=domain.identifier(c.challengeId);}
    const challengeRef=ref('arenaPKChallenges',challengeId),[snapshot]=await tx.getAll(challengeRef),current=snapshot.data();let next,outcome,consume=null;
    if(create){
      if(current)fail('challenge-already-exists');if(config.rules?.version!==adapter.VERSION||config.rules.targetScore!==4)fail('invalid-rules');const ttl=config.pairingTtlMs;if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>300000)fail('invalid-pairing-policy');
      next=domain.create({challengeId,creatorUid:uid,rules:config.rules,now,expiresAt:now+ttl,matchCount:input.matchCount});next.practiceXpPolicy=xp.VERSION;next.pkAchievementPolicy=ach.VERSION;next.participantNames={[uid]:name(profile)};next.pairingTokenHash=hash(tokenValue);next.pairingCodeHash=hash(pairingCode);outcome={challenge:view(next),pairingToken:tokenValue,pairingCode};
    }else{
      if(!current||current.environment!==ENV)fail('challenge-unavailable');
      if(!accept&&!revoke&&!current.participants.includes(uid))fail('participant-required');
      if(accept){if(current.status!=='proposed'||current.participants.includes(uid)||now>=current.expiresAt)fail('pairing-unavailable');if(operation==='acceptCode'?hash(suppliedCode)!==current.pairingCodeHash:typeof input.pairingToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.pairingToken)||hash(input.pairingToken)!==current.pairingTokenHash)fail('pairing-unavailable');consume=ref('arenaPKCodes',current.pairingCodeHash);await tx.getAll(consume);}
      if(!revoke&&!['cancel','reject'].includes(operation)){const peers=await tx.getAll(...current.participants.filter(p=>p!==uid).map(p=>ref('users',p)));for(const [i,p]of current.participants.filter(p=>p!==uid).entries())admit(peers[i].data(),config,p);}
      if(read){const expired=['proposed','accepted'].includes(current.status)&&now>=current.expiresAt;const shown=expired?{...current,status:'expired',revision:current.revision+1}:current;if(expired){tx.set(challengeRef,shown);tx.set(ref('arenaPKAudit',hash([challengeId,'expiry'])),{operation:'expire',challengeId,revision:shown.revision,at:now});}return {challenge:view(shown),expired};}
      if(revoke){if(current.status!=='completed'||input.expectedRevision!==current.revision)fail('revision-conflict');next={...current,status:'revoked',revision:current.revision+1,revokedAt:now,revokedBy:uid,revocationReason:input.reason};}
      else{const command={...input};for(const k of ['challengeId','requestId','pairingToken','pairingCode'])delete command[k];next=domain.transition(current,uid,operation==='acceptCode'?'accept':operation,command,now);if(accept){next.participantNames={...next.participantNames,[uid]:name(profile)};delete next.pairingTokenHash;delete next.pairingCodeHash;}}
      outcome={challenge:view(next)};
    }
    if(next.status==='completed'&&current?.status!=='completed'||revoke){
      const games=[...(next.games||[]),domain.gameRecord(next,next.completedAt)],players=await tx.getAll(...next.participants.map(p=>ref('arenaPKPlayers',p)));
      // Validate ALL rows and read ALL counters before the first write. Max 100 games / 200 ledger docs.
      const writes=[],day=xp.dayKey(now),enabled=!revoke&&next.practiceXpPolicy===xp.VERSION&&config.practiceXpEnabled!==false;
      const dayRefs=next.participants.map(p=>ref('arenaPKPlayers',p).collection('xpDays').doc(day));
      const days=enabled?await tx.getAll(...dayRefs):[];
      const achievementEnabled=!revoke&&next.pkAchievementPolicy===ach.VERSION;
      const achievementRefs=next.participants.map(p=>ref('arenaPKPlayers',p).collection('achievementDays').doc(day));
      const achievementDays=achievementEnabled?await tx.getAll(...achievementRefs):[];
      const oldRows=revoke?await tx.getAll(...next.participants.flatMap(p=>games.map(g=>ledger(p).doc(next.challengeId+'_g'+String(g.number).padStart(3,'0'))))):[];
      next.practiceXpByPlayer={};
      for(const [i,p]of next.participants.entries()){
        const prior=players[i].data()||{uid:p,environment:ENV,total:0,wins:0,losses:0,generation:0};if(prior.uid!==p||prior.environment!==ENV||![prior.total,prior.wins,prior.losses,prior.generation].every(v=>Number.isSafeInteger(v)&&v>=0)||prior.wins+prior.losses!==prior.total)fail('history-unavailable');
        const state=enabled?xp.daily(days[i].data(),p,day):null;let deltaUnits=0;const achievementState=achievementEnabled?ach.daily(achievementDays[i].data(),p,day):null;
        const wins=games.filter(g=>g.winnerUid===p).length,sign=revoke?-1:1;if(prior.total+sign*games.length<0)fail('history-unavailable');
        for(const [gameIndex,game]of games.entries()){
          let reward=null;let achievement=achievementState?ach.award(achievementState,next.participants.find(uid=>uid!==p)):null;
          if(enabled){reward=xp.award(state,next.participants.find(uid=>uid!==p));deltaUnits+=reward.units;}
          if(revoke){const old=oldRows[i*games.length+gameIndex].data();if(!old||old.completed!==true)fail('ledger-incomplete');if(!ach.validate(old.pkAchievement,old.confirmedAt))fail('ledger-achievement-invalid');achievement=old.pkAchievement||null;if(old.practiceXp){if(old.practiceXp.version!==xp.VERSION||!Number.isSafeInteger(old.practiceXp.units)||old.practiceXp.units<0)fail('ledger-xp-invalid');reward={...old.practiceXp,revoked:true};deltaUnits-=reward.units;}}
          const row={schemaVersion:1,environment:ENV,challengeId:next.challengeId,playerUid:p,participants:next.participants,names:next.participantNames,rules:next.rules,certificationSource:'SELF',completed:!revoke,confirmedBy:next.finishConfirmedBy,confirmedAt:next.completedAt,sourceRevision:next.revision,updatedAt:now,game,...(reward?{practiceXp:reward}:{}),...(achievement?{pkAchievement:achievement}:{})};const r=adapter.record(row,p);if(!revoke&&!r.analyzable)fail('ledger-incomplete');writes.push([ledger(p).doc(next.challengeId+'_g'+String(game.number).padStart(3,'0')),row]);}
        const totalUnits=xp.units(prior)+deltaUnits;if(!Number.isSafeInteger(totalUnits)||totalUnits<0)fail('ledger-xp-invalid');
        next.practiceXpByPlayer[p]={version:xp.VERSION,xp:revoke?0:deltaUnits/2,reason:revoke?'revoked':enabled?'settled':next.practiceXpPolicy===xp.VERSION?'disabled':'before-launch',...(state?{day,remainingGames:Math.max(0,xp.DAILY_LIMIT-state.completedGames)}:{})};
        writes.push([ref('arenaPKPlayers',p),{...prior,uid:p,environment:ENV,total:prior.total+sign*games.length,wins:prior.wins+sign*wins,losses:prior.losses+sign*(games.length-wins),generation:prior.generation+1,practiceXpUnits:totalUnits,updatedAt:now}]);
        if(state)writes.push([dayRefs[i],state]);if(achievementState)writes.push([achievementRefs[i],achievementState]);
      }
      for(const [r,v]of writes)tx.set(r,v);
    }
    outcome={...outcome,challenge:view(next)};
    if(create)tx.set(codeRef,{environment:ENV,challengeId,expiresAt:next.expiresAt,used:false});
    if(consume)tx.set(consume,{environment:ENV,challengeId,expiresAt:current.expiresAt,used:true});
    if(create)tx.create(challengeRef,next);else tx.set(challengeRef,next);
    tx.create(receiptRef,{actorUid:uid,operation,fingerprint,outcome,createdAt:now});tx.create(ref('arenaPKAudit',hash([uid,operation,input.requestId])),{actorUid:uid,operation,challengeId,revision:next.revision,at:now,...(revoke?{reason:input.reason}:{})});return outcome;
  });
 }
 return Object.freeze({run});
}
module.exports={createService};
