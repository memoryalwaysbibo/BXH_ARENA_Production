'use strict';
const valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const eventCode=s=>typeof s==='string'&&/^BXH-[A-Z0-9]{6}$/.test(s);
function createActivityAwarder({db}){
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
   if(!tour||!membership?.teamId||!valid(membership.teamId))return {status:'ineligible'};
   let state;try{state=typeof tour.data==='string'?JSON.parse(tour.data):tour.data;}catch{return {status:'ineligible'};}
   const at=state?.archivedAt,results=tour.ladderResults;
   const official=(tour.eventAuthority==='official'||state?.meta?.eventAuthority==='official')&&(tour.ladderMode==='ranked'||state?.meta?.ladderMode==='ranked')&&tour.archiveStatus==='completed'&&tour.ladderPointsAwarded===true&&tour.ladderSeasonId===log.seasonId&&state?.archiveStatus==='completed'&&state?.ladderPointsAwarded===true&&state?.testMode!==true&&state?.meta?.testMode!==true&&tour.testMode!==true&&tour.eventCancelled!==true&&state?.meta?.eventCancelled!==true&&tour.tournamentPhase==='done'&&Number.isSafeInteger(at)&&at>=0;
   const matching=Array.isArray(results)&&results.filter(r=>r&&r.playerUid===log.playerUid&&r.eventCode===log.eventCode&&r.seasonId===log.seasonId&&r.pointsEarned===log.pointsEarned).length===1;
   if(!official||!matching||!Number.isSafeInteger(membership.joinedAt)||membership.joinedAt<0||membership.joinedAt>at)return {status:'ineligible'};
   const team=await read(tx,'teamsV1/'+membership.teamId);
   if(team?.status!=='active'||!team.memberUids?.includes(log.playerUid)||!Number.isSafeInteger(team.totalXp)||team.totalXp<0||team.totalXp>=Number.MAX_SAFE_INTEGER)return {status:'ineligible'};
   tx.create(db.doc(receiptPath),{teamId:membership.teamId,eventId:log.eventCode,uid:log.playerUid,archivedAt:at,archived:true,ranked:true,completed:true,createdAt:at});
   tx.update(db.doc('teamsV1/'+membership.teamId),{totalXp:team.totalXp+1});
   return {status:'awarded',teamId:membership.teamId};
  });
 };
}
module.exports={createActivityAwarder};
