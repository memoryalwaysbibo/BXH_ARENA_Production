'use strict';

const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {getFirestore,FieldValue}=require("./_qr_checkin/admin-firestore.cjs");
const core=require('./ladder-settlement-core');

const REGION='asia-east1';
const SYSTEM_ACTOR='system:auto-settlement';

function parseState(top){
  try{return typeof top?.data==='string'?JSON.parse(top.data):top?.data||{};}catch{return {};}
}
function txId(code,uid){return String(code+'_'+uid).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,1400);}
function publicFinalPatch(publicSnap,now){
  const patch={tournamentPhase:'done',archiveStatus:'completed',updatedAt:now};
  if(!publicSnap?.exists)return null;
  const data=publicSnap.data()||{};
  try{
    const view=JSON.parse(data.bracketView||'{}');
    if(view&&typeof view==='object'){
      view.archiveStatus='completed';
      view.completedAt=view.completedAt||now;
      view.archivedAt=view.archivedAt||now;
      view.ladderPointsAwarded=true;
      patch.bracketView=JSON.stringify(view);
    }
  }catch(e){}
  return patch;
}
function finalState(st,plan,results,now){
  const out=JSON.parse(JSON.stringify(st||{}));
  out.settlementRoute='official-ranked';
  out.settlementPhase='completed';
  out.settlementAttempt=Math.max(1,Number(out.settlementAttempt||0)+1);
  out.settlementStartedAt=out.settlementStartedAt||now;
  out.settlementCompletedAt=now;
  out.settlementError=null;
  out.settlementErrorCode=null;
  out.archiveStatus='completed';
  out.completedAt=out.completedAt||now;
  out.archivedAt=out.archivedAt||now;
  out.ladderPointsAwarded=true;
  out.ladderSeasonId=plan.seasonId;
  out.ladderAwardedAt=now;
  out.ladderSkippedPlayers=plan.skipped.slice();
  out.ladderResults=results;
  out.updatedAt=now;
  return out;
}
function finalizeAlreadyAwardedState(st,top,now){
  const out=JSON.parse(JSON.stringify(st||{}));
  out.settlementRoute='official-ranked';
  out.settlementPhase='completed';
  out.settlementError=null;
  out.settlementErrorCode=null;
  out.archiveStatus='completed';
  out.completedAt=out.completedAt||now;
  out.archivedAt=out.archivedAt||now;
  out.settlementCompletedAt=out.settlementCompletedAt||now;
  out.ladderPointsAwarded=true;
  out.ladderSeasonId=out.ladderSeasonId||top.ladderSeasonId||null;
  out.ladderAwardedAt=out.ladderAwardedAt||now;
  if(!Array.isArray(out.ladderResults)&&Array.isArray(top.ladderResults))out.ladderResults=top.ladderResults;
  if(!Array.isArray(out.ladderSkippedPlayers)&&Array.isArray(top.ladderSkippedPlayers))out.ladderSkippedPlayers=top.ladderSkippedPlayers;
  out.updatedAt=now;
  return out;
}

function createSettlementService({db=getFirestore(),serverTimestamp=()=>FieldValue.serverTimestamp(),clock=()=>Date.now()}={}){
  async function settle(code){
    const eventCode=String(code||'').trim().toUpperCase();
    if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode))return {ok:false,reason:'invalid-code'};
    const tourRef=db.doc('tournaments/'+eventCode);
    const publicRef=db.doc('publicTournaments/'+eventCode);
    const controlRef=db.doc('ladderSystem/current');

    return db.runTransaction(async tx=>{
      const [tourSnap,publicSnap,controlSnap]=await Promise.all([tx.get(tourRef),tx.get(publicRef),tx.get(controlRef)]);
      if(!tourSnap.exists)return {ok:false,reason:'event-not-found'};
      const top=tourSnap.data()||{},st=parseState(top);
      const eligible=core.tournamentEligible(top,st);
      if(!eligible.ok)return {ok:false,reason:eligible.reason};

      const now=clock();
      if(top.ladderPointsAwarded===true||st.ladderPointsAwarded===true){
        if(st.archiveStatus==='completed'&&top.archiveStatus==='completed')return {ok:true,alreadyAwarded:true,alreadyArchived:true};
        const completed=finalizeAlreadyAwardedState(st,top,now);
        tx.set(tourRef,{data:JSON.stringify(completed),archiveStatus:'completed',tournamentPhase:'done',updatedAt:now},{merge:true});
        const pubPatch=publicFinalPatch(publicSnap,now);if(pubPatch)tx.set(publicRef,pubPatch,{merge:true});
        return {ok:true,alreadyAwarded:true,archived:true,seasonId:completed.ladderSeasonId||null};
      }

      if(!controlSnap.exists)return {ok:false,reason:'season-unavailable'};
      const control=controlSnap.data()||{};
      let scored;
      try{scored=core.analyze(st);}catch(e){return {ok:false,reason:e.reason||e.message||'scoring-failed'};}

      const candidates=[...new Set(scored.players.map(x=>core.candidateUid(x.player)).filter(Boolean))];
      const userRefs=candidates.map(uid=>db.doc('users/'+uid));
      const userSnaps=await Promise.all(userRefs.map(ref=>tx.get(ref)));
      const profiles={};userSnaps.forEach((snap,i)=>{if(snap.exists)profiles[candidates[i]]=snap.data()||{};});

      let plan;
      try{plan=core.buildPlan(top,st,profiles,control);}catch(e){return {ok:false,reason:e.reason||e.message||'plan-failed'};}

      const txRefs=plan.rows.map(row=>db.doc('ladderTransactions/'+txId(eventCode,row.uid)));
      const playerRefs=plan.rows.map(row=>db.doc('ladderPlayers/'+row.uid));
      const [priorTxSnaps,playerSnaps]=await Promise.all([
        Promise.all(txRefs.map(ref=>tx.get(ref))),
        Promise.all(playerRefs.map(ref=>tx.get(ref)))
      ]);

      const results=[];
      for(let i=0;i<plan.rows.length;i++){
        const row=plan.rows[i],profile=profiles[row.uid]||{},prior=priorTxSnaps[i],playerSnap=playerSnaps[i];
        if(prior.exists){
          const log=prior.data()||{};
          results.push({
            playerUid:row.uid,playerName:row.playerName,pointsEarned:Number(log.pointsEarned??row.pointsEarned)||0,
            placement:log.placement??row.placement,wins:Number(log.wins??row.wins)||0,losses:Number(log.losses??row.losses)||0,
            scoring:log.scoring||row.scoring,beforeSeasonPoints:Number(log.beforeSeasonPoints||0),afterSeasonPoints:Number(log.afterSeasonPoints||0),
            beforeCareerPoints:Number(log.beforeCareerPoints||0),afterCareerPoints:Number(log.afterCareerPoints||0),alreadyAwarded:true
          });
          continue;
        }
        const old=playerSnap.exists?playerSnap.data()||{}:{};
        const beforeSeason=Math.max(0,Number(old.seasonPoints||0));
        const beforeCareer=Math.max(0,Number(old.careerPoints||0));
        const delta=Math.max(0,Number(row.pointsEarned||0));
        const afterSeason=beforeSeason+delta;
        const afterCareer=plan.countsTowardCareer?beforeCareer+delta:beforeCareer;
        const rankTier=core.tier(afterSeason);
        const oldHigh=String(old.highestRankTier||'未定級');
        const highestRankTier=plan.countsTowardCareer&&core.tierIndex(rankTier)>core.tierIndex(oldHigh)?rankTier:oldHigh;
        const playerPatch={
          uid:row.uid,
          playerName:String(row.playerName||profile.realName||profile.displayName||profile.nickname||row.uid),
          currentSeason:plan.seasonId,
          seasonPoints:afterSeason,
          careerPoints:afterCareer,
          rankTier,
          highestRankTier,
          totalEvents:Number(old.totalEvents||0)+1,
          rankedWins:Number(old.rankedWins||0)+Number(row.wins||0),
          rankedLosses:Number(old.rankedLosses||0)+Number(row.losses||0),
          championCount:Number(old.championCount||0)+(row.placement===1?1:0),
          runnerUpCount:Number(old.runnerUpCount||0)+(row.placement===2?1:0),
          thirdPlaceCount:Number(old.thirdPlaceCount||0)+(row.placement===3?1:0),
          fourthPlaceCount:Number(old.fourthPlaceCount||0)+(row.placement===4?1:0),
          lastPointsUpdatedAt:serverTimestamp()
        };
        tx.set(playerRefs[i],playerPatch,{merge:true});
        const log={
          type:'event',actorUid:SYSTEM_ACTOR,actorName:'BXH AUTO',playerUid:row.uid,playerName:playerPatch.playerName,
          seasonId:plan.seasonId,isTrialSeason:plan.isTrialSeason,countsTowardCareer:plan.countsTowardCareer,
          beforeSeasonPoints:beforeSeason,afterSeasonPoints:afterSeason,beforeCareerPoints:beforeCareer,afterCareerPoints:afterCareer,
          delta,pointsEarned:delta,eventCode,eventName:String(st.meta?.name||top.name||''),eventDate:String(st.meta?.date||top.eventDate||''),
          formatType:String(st.meta?.formatType||top.formatType||'single'),placement:row.placement||null,
          wins:Number(row.wins||0),losses:Number(row.losses||0),scoring:row.scoring,createdAt:serverTimestamp()
        };
        tx.create(txRefs[i],log);
        results.push({
          playerUid:row.uid,playerName:playerPatch.playerName,seasonId:plan.seasonId,
          isTrialSeason:plan.isTrialSeason,countsTowardCareer:plan.countsTowardCareer,
          beforeSeasonPoints:beforeSeason,afterSeasonPoints:afterSeason,beforeCareerPoints:beforeCareer,afterCareerPoints:afterCareer,
          delta,pointsEarned:delta,eventCode,eventName:log.eventName,eventDate:log.eventDate,formatType:log.formatType,
          placement:row.placement||null,wins:Number(row.wins||0),losses:Number(row.losses||0),scoring:row.scoring,alreadyAwarded:false
        });
      }

      const completed=finalState(st,plan,results,now);
      const topPatch={
        data:JSON.stringify(completed),archiveStatus:'completed',tournamentPhase:'done',updatedAt:now,
        ladderPointsAwarded:true,ladderSeasonId:plan.seasonId,ladderAwardedAt:serverTimestamp(),ladderAwardedBy:SYSTEM_ACTOR,
        ladderResults:results,ladderSkippedPlayers:plan.skipped,ladderTrialSeason:plan.isTrialSeason,ladderCountsTowardCareer:plan.countsTowardCareer
      };
      tx.set(tourRef,topPatch,{merge:true});
      const pubPatch=publicFinalPatch(publicSnap,now);if(pubPatch)tx.set(publicRef,pubPatch,{merge:true});
      return {ok:true,alreadyAwarded:results.every(x=>x.alreadyAwarded===true),archived:true,seasonId:plan.seasonId,results,skippedPlayers:plan.skipped};
    });
  }
  return {settle};
}

let defaultService=null;
function getDefaultService(){if(!defaultService)defaultService=createSettlementService();return defaultService;}
const PERMANENT=new Set(['invalid-code','event-not-found','not-official','not-ranked','test-event','cancelled','synthetic-test-roster','not-decided','placements-incomplete','unsupported-format','single-bracket-missing','insufficient-effective-players','insufficient-eligible-players','duplicate-account','eligible-player-limit','season-unavailable']);

exports.ladderAutoSettlement=onDocumentWritten(
  {document:'tournaments/{code}',region:REGION,retry:true,maxInstances:10},
  async event=>{
    const after=event.data?.after;
    if(!after?.exists)return;
    const top=after.data()||{},st=parseState(top),eligible=core.tournamentEligible(top,st);
    if(!eligible.ok)return;
    try{
      const result=await getDefaultService().settle(event.params.code);
      if(!result.ok){
        const payload={code:event.params.code,reason:result.reason};
        if(PERMANENT.has(result.reason)){console.warn('ladder-auto-settlement-skipped',payload);return;}
        throw Object.assign(Error(result.reason||'auto-settlement-failed'),{result});
      }
      console.log('ladder-auto-settlement-complete',{code:event.params.code,alreadyAwarded:!!result.alreadyAwarded,alreadyArchived:!!result.alreadyArchived,seasonId:result.seasonId||null});
    }catch(error){
      console.error('ladder-auto-settlement-error',{code:event.params.code,message:String(error?.message||error)});
      throw error;
    }
  }
);

exports._ladderAutoSettlementTest={parseState,txId,publicFinalPatch,finalState,finalizeAlreadyAwardedState,createSettlementService};
