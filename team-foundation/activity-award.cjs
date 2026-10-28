'use strict';
const {resolveTenure}=require('./membership-tenure.cjs');
const {recordDailyActivity}=require('./activity.cjs');
const valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const eventCode=s=>typeof s==='string'&&/^BXH-[A-Z0-9]{6}$/.test(s);
function createActivityAwarder({db,clock=Date.now}){
 if(!db?.doc||!db?.runTransaction)throw Error('database-required');
 const read=async(tx,path)=>{const snap=await tx.get(db.doc(path));return snap.exists?snap.data():null;};
 return async function award(ledgerId){
  if(!valid(ledgerId))throw Error('invalid-ledger-id');
  return db.runTransaction(async tx=>{
   const log=await read(tx,'ladderTransactions/'+ledgerId);
   if(!log||log.type!=='event'||!valid(log.playerUid)||!eventCode(log.eventCode)||ledgerId!==log.eventCode+'_'+log.playerUid||typeof log.seasonId!=='string'||!log.seasonId||!Number.isFinite(log.pointsEarned)||log.pointsEarned<0)return {status:'ineligible'};
   const receiptPath='teamActivityReceiptsV1/'+ledgerId;
   if(await read(tx,receiptPath))return {status:'already-awarded'};
   const [tour,membership]=await Promise.all([read(tx,'tournaments/'+log.eventCode),read(tx,'teamMembershipsV1/'+log.playerUid)]);
   if(!tour)return {status:'ineligible'};
   let state;try{state=typeof tour.data==='string'?JSON.parse(tour.data):tour.data;}catch{return {status:'ineligible'};}
   const at=state?.archivedAt,results=tour.ladderResults;
   const official=(tour.eventAuthority==='official'||state?.meta?.eventAuthority==='official')&&(tour.ladderMode==='ranked'||state?.meta?.ladderMode==='ranked')&&tour.archiveStatus==='completed'&&tour.ladderPointsAwarded===true&&tour.ladderSeasonId===log.seasonId&&state?.archiveStatus==='completed'&&state?.ladderPointsAwarded===true&&state?.testMode!==true&&state?.meta?.testMode!==true&&tour.testMode!==true&&tour.eventCancelled!==true&&state?.meta?.eventCancelled!==true&&tour.tournamentPhase==='done'&&Number.isSafeInteger(at)&&at>=0;
   const matching=Array.isArray(results)&&results.filter(r=>r&&(r.playerUid??r.playerId)===log.playerUid&&(r.playerUid===undefined||r.playerId===undefined||r.playerUid===r.playerId)&&(r.eventCode===undefined||r.eventCode===log.eventCode)&&(r.seasonId===undefined||r.seasonId===log.seasonId)&&r.pointsEarned===log.pointsEarned).length===1;
   if(!official||!matching)return {status:'ineligible'};
   let target=membership&&valid(membership.teamId)&&Number.isSafeInteger(membership.joinedAt)&&membership.joinedAt>=0&&membership.joinedAt<=at?{teamId:membership.teamId,tenureId:membership.tenureId??null}:null;
   if(!target){
    const snaps=await tx.get(db.collectionGroup('tenures').where('uid','==',log.playerUid).where('joinedAt','<=',at).orderBy('joinedAt','desc').limit(2));
    target=resolveTenure({uid:log.playerUid,archivedAt:at,tenures:snaps.docs.map(s=>s.data())});
   }
   if(!target)return {status:'ineligible'};
   const sameStint=membership?.teamId===target.teamId&&(target.tenureId===null||membership.tenureId===target.tenureId);
   const team=await read(tx,'teamsV1/'+target.teamId);
   if(team?.status!=='active'||(sameStint&&!team.memberUids?.includes(log.playerUid))||!Number.isSafeInteger(team.totalXp)||team.totalXp<0||team.totalXp>=Number.MAX_SAFE_INTEGER)return {status:'ineligible'};
   const contribution=sameStint?(membership.experienceContribution??0):0;
   if(!Number.isSafeInteger(contribution)||contribution<0||contribution>=Number.MAX_SAFE_INTEGER)throw Error('invalid-contribution');
   const dailyActivity=recordDailyActivity({dailyActivity:team.dailyActivity,uid:log.playerUid,archivedAt:at,now:clock(),members:team.memberUids});
   if(sameStint)tx.update(db.doc('teamMembershipsV1/'+log.playerUid),{experienceContribution:contribution+1});
   tx.create(db.doc(receiptPath),{teamId:target.teamId,eventId:log.eventCode,uid:log.playerUid,archivedAt:at,archived:true,ranked:true,completed:true,createdAt:at});
   tx.update(db.doc('teamsV1/'+target.teamId),{totalXp:team.totalXp+1,dailyActivity});
   return {status:'awarded',teamId:target.teamId};
  });
 };
}
module.exports={createActivityAwarder};
