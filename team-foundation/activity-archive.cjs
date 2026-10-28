'use strict';
// Archive completion is a second delivery opportunity when the ledger was created
// before archival. The award transaction revalidates canonical records and deduplicates.
function createArchiveActivityHandler({award,enabled=()=>false}){
 if(typeof award!=='function')throw Error('award-required');
 return async event=>{
  if(!enabled())return {status:'disabled'};
  const code=event?.params?.code;
  if(typeof code!=='string'||!/^BXH-[A-Z0-9]{6}$/.test(code))return {status:'ineligible'};
  const snap=event.data?.after;if(!snap?.exists)return {status:'ineligible'};
  const top=snap.data();let state;try{state=typeof top.data==='string'?JSON.parse(top.data):top.data;}catch{return {status:'ineligible'};}
  if(top.archiveStatus!=='completed'||state?.archiveStatus!=='completed'||top.ladderPointsAwarded!==true||state?.ladderPointsAwarded!==true)return {status:'ineligible'};
  const before=event.data?.before;
  if(before?.exists){const old=before.data();if(old.archiveStatus===top.archiveStatus&&old.ladderPointsAwarded===top.ladderPointsAwarded&&old.ladderSeasonId===top.ladderSeasonId&&old.data===top.data&&JSON.stringify(old.ladderResults)===JSON.stringify(top.ladderResults))return {status:'unchanged'};}
  const rows=top.ladderResults;
  if(!Array.isArray(rows)||rows.length>512)throw Error('invalid-archive-results');
  const uids=[...new Set(rows.map(r=>r?.playerUid??r?.playerId))];
  if(uids.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)))throw Error('invalid-archive-player');
  let next=0,awarded=0,failed=0;
  await Promise.all(Array.from({length:Math.min(3,uids.length)},async()=>{
   while(next<uids.length){const uid=uids[next++];try{const r=await award(code+'_'+uid);if(r.status==='awarded')awarded++;}catch{failed++;}}
  }));
  if(failed)throw Error('archive-activity-retry-required');
  return {status:'processed',examined:uids.length,awarded};
 };
}
module.exports={createArchiveActivityHandler};
