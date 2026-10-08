'use strict';
// HC-01 domain only. Completion is an unrated record, never an award/settlement.
const POINTS = Object.freeze({spin:1,knockout:2,burst:2,extreme:3});
const OPERATIONS = Object.freeze(['accept','reject','start','proposeRound','recordRound','undoRound','resumeReview','nextGame','endSession','confirmRound','confirmFinish','dispute','cancel']);
const fail = reason => { throw Error(reason); };
function identifier(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))fail('invalid-id');return value;}
function keys(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('invalid-input');}
function policy(rules){
  keys(rules,['version','targetScore']);identifier(rules.version);
  if(!Number.isSafeInteger(rules.targetScore)||rules.targetScore<1||rules.targetScore>20)fail('invalid-rules');
  return {version:rules.version,targetScore:rules.targetScore};
}
function create({challengeId,creatorUid,rules,now,expiresAt,matchCount=1}){
  identifier(challengeId);identifier(creatorUid);policy(rules);
  if(!Number.isSafeInteger(matchCount)||matchCount<0||matchCount>100)fail('invalid-input');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(expiresAt)||expiresAt<=now)fail('invalid-time');
  return {schemaVersion:1,environment:'sandbox',challengeId,participants:[creatorUid],rules:policy(rules),
    status:'proposed',revision:0,createdAt:now,expiresAt,ready:[],rounds:[],pendingRound:null,
    score:{a:0,b:0},finishConfirmedBy:[],resultRevision:null,matchCount,gameNumber:1,games:[],sessionClosing:false};
}
function finishedStatus(c){return c.sessionClosing||(c.gameNumber||1)>=(c.matchCount===0?100:(c.matchCount||1))?'final_pending':'game_pending';}
function gameRecord(c,now){return{number:c.gameNumber||1,score:structuredClone(c.score),winnerUid:c.winnerUid,rounds:structuredClone(c.rounds),corrections:structuredClone(c.corrections||[]),startedAt:c.startedAt||c.createdAt,endedAt:now};}
function transition(original,uid,operation,input,now){
  identifier(uid);if(!OPERATIONS.includes(operation))fail('invalid-operation');
  const extra=['proposeRound','recordRound'].includes(operation)?['winnerUid','finish']:operation==='confirmRound'?['roundRevision']:operation==='confirmFinish'?['resultRevision']:[];
  keys(input,['expectedRevision',...extra]);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==original.revision)fail('revision-conflict');
  if(!Number.isSafeInteger(now)||now<original.createdAt)fail('invalid-time');
  const c=structuredClone(original);
  if(c.environment!=='sandbox'||c.schemaVersion!==1)fail('environment-mismatch');
  if(['completed','cancelled','rejected','expired','disputed'].includes(c.status))fail('terminal-state');
  if(['proposed','accepted'].includes(c.status)&&now>=c.expiresAt){c.status='expired';c.revision++;return c;}
  if(operation==='accept'){
    if(c.status!=='proposed'||c.participants.includes(uid))fail('pairing-unavailable');
    c.participants.push(uid);c.status='accepted';
  }else{
    if(!c.participants.includes(uid))fail('participant-required');
    if(operation==='reject'){
      // Creator can cancel; rejection is for an accepted opponent.
      if(c.status!=='accepted'||uid===c.participants[0])fail('invalid-state');c.status='rejected';
    }else if(operation==='cancel'){c.status='cancelled';}
    else if(operation==='start'){
      if(c.status!=='accepted'||c.ready.includes(uid))fail('invalid-state');c.ready.push(uid);
      if(c.ready.length===2){c.status='in_progress';c.startedAt=now;}
    }else if(operation==='proposeRound'){
      if(c.status!=='in_progress'||!c.participants.includes(input.winnerUid)||!Object.hasOwn(POINTS,input.finish))fail('invalid-round');
      c.pendingRound={number:c.rounds.length+1,winnerUid:input.winnerUid,finish:input.finish,
        points:POINTS[input.finish],roundRevision:c.revision+1,confirmedBy:[uid],proposedAt:now};
      c.status='round_pending';
    }else if(operation==='recordRound'){
      if(!['in_progress','score_review'].includes(c.status)||c.pendingRound||Math.max(c.score.a,c.score.b)>=c.rules.targetScore||uid!==c.participants[0]||!c.participants.includes(input.winnerUid)||!Object.hasOwn(POINTS,input.finish))fail('invalid-round');
      const r={number:c.rounds.length+1,winnerUid:input.winnerUid,finish:input.finish,
        points:POINTS[input.finish],roundRevision:c.revision+1,recordedBy:uid,recordedAt:now};
      c.rounds.push(r);c.score[r.winnerUid===c.participants[0]?'a':'b']+=r.points;
      c.status=c.status==='score_review'?'score_review':Math.max(c.score.a,c.score.b)>=c.rules.targetScore?finishedStatus(c):'in_progress';
      if(['game_pending','final_pending'].includes(c.status)){c.resultRevision=c.status==='final_pending'?c.revision+1:null;c.winnerUid=r.winnerUid;}
    }else if(operation==='undoRound'){
      if(uid!==c.participants[0]||!['in_progress','round_pending','game_pending','final_pending','score_review'].includes(c.status)||(!c.pendingRound&&!c.rounds.length))fail('undo-unavailable');
      const wasReview=c.status==='score_review',pending=!!c.pendingRound;
      const removed=pending?c.pendingRound:c.rounds.pop();
      if(!pending)c.score[removed.winnerUid===c.participants[0]?'a':'b']-=removed.points;
      c.pendingRound=null;c.finishConfirmedBy=[];c.resultRevision=null;delete c.winnerUid;
      c.corrections=(c.corrections||[]).concat([{round:removed,pending,undoneBy:uid,at:now,revision:c.revision+1}]);
      c.status=wasReview?'score_review':'in_progress';
    }else if(operation==='resumeReview'){
      if(uid!==c.participants[0]||c.status!=='score_review')fail('review-unavailable');
      c.finishConfirmedBy=[];
      c.status=c.pendingRound?'round_pending':Math.max(c.score.a,c.score.b)>=c.rules.targetScore?finishedStatus(c):'in_progress';
      c.resultRevision=c.status==='final_pending'?c.revision+1:null;
      if(['game_pending','final_pending'].includes(c.status))c.winnerUid=c.participants[c.score.a>=c.rules.targetScore?0:1];
      else delete c.winnerUid;
    }else if(operation==='nextGame'){
      if(uid!==c.participants[0]||c.status!=='game_pending'||(c.gameNumber||1)>=100)fail('invalid-state');
      c.games=(c.games||[]).concat([gameRecord(c,now)]);c.gameNumber=(c.gameNumber||1)+1;
      c.score={a:0,b:0};c.rounds=[];c.corrections=[];c.pendingRound=null;c.finishConfirmedBy=[];c.resultRevision=null;delete c.winnerUid;c.startedAt=now;c.status='in_progress';
    }else if(operation==='endSession'){
      if(uid!==c.participants[0]||c.status!=='game_pending')fail('invalid-state');
      c.sessionClosing=true;c.status='final_pending';c.resultRevision=c.revision+1;c.finishConfirmedBy=[];
    }else if(operation==='confirmRound'){
      const r=c.pendingRound;
      if(c.status!=='round_pending'||!r||input.roundRevision!==r.roundRevision||r.confirmedBy.includes(uid))fail('round-confirmation-invalid');
      r.confirmedBy.push(uid);r.confirmedAt=now;
      c.rounds.push(r);c.pendingRound=null;
      c.score[r.winnerUid===c.participants[0]?'a':'b']+=r.points;
      c.status=Math.max(c.score.a,c.score.b)>=c.rules.targetScore?finishedStatus(c):'in_progress';
      if(['game_pending','final_pending'].includes(c.status)){c.resultRevision=c.status==='final_pending'?c.revision+1:null;c.winnerUid=r.winnerUid;}
    }else if(operation==='confirmFinish'){
      if(c.status!=='final_pending'||input.resultRevision!==c.resultRevision||c.finishConfirmedBy.includes(uid))fail('finish-confirmation-invalid');
      c.finishConfirmedBy.push(uid);
      if(c.finishConfirmedBy.length===2){c.status='completed';c.completedAt=now;c.certificationSource='SELF';c.ratingStatus='not_awarded';}
    }else if(operation==='dispute'){
      if(!['in_progress','round_pending','game_pending','final_pending'].includes(c.status))fail('invalid-state');
      c.status='score_review';c.disputedBy=uid;c.disputedAt=now;c.finishConfirmedBy=[];c.resultRevision=null;delete c.winnerUid;
    }
  }
  if(c.revision>=Number.MAX_SAFE_INTEGER)fail('revision-overflow');c.revision++;return c;
}
module.exports=Object.freeze({POINTS,OPERATIONS,identifier,keys,policy,create,transition,gameRecord});
