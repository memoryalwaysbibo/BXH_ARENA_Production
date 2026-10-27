'use strict';
const {createSeasonLadderReader}=require('./projection.cjs');
const TIERS=['ungraded','e','d','c','b','a','s','national'];
// Uses publicPlayers and the actual hunter leaderboard's immutable snapshot.
// Unknown/pending/non-public hunter records remain null; never infer an ungraded tier.
function createPublicPlayerReader({db}){
 const readLadder=createSeasonLadderReader({db});
 return async ({tx,uids})=>{
  if(!Array.isArray(uids)||uids.length<1||uids.length>20||new Set(uids).size!==uids.length||uids.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)))throw Error('invalid-player-list');
  const [ladder,profiles,pointer]=await Promise.all([
   readLadder({tx,uids}),Promise.all(uids.map(uid=>tx.get(db.doc('publicPlayers/'+uid)))),tx.get(db.doc('hunterLeaderboardMeta/current'))
  ]);
  if(!pointer.exists||!/^g\d{13}-[a-f0-9]{12}$/.test(pointer.data()?.generation||''))throw Error('hunter-snapshot-unavailable');
  const generation=pointer.data().generation,snap=await tx.get(db.doc('hunterLeaderboardSnapshots/'+generation));
  const board=snap.exists?snap.data():null;
  if(!board||board.generation!==generation||board.version!=='hunter-leaderboard-v1'||board.promotionPolicy!=='medium-or-larger-v1'||!Array.isArray(board.rows))throw Error('hunter-snapshot-unavailable');
  const requested=new Set(uids),rows=new Map();
  for(const row of board.rows){if(!requested.has(row.uid))continue;if(rows.has(row.uid)||!TIERS.includes(row.tier))throw Error('hunter-snapshot-invalid');rows.set(row.uid,row);}
  const players=uids.map((uid,i)=>{
   const profile=profiles[i].exists?profiles[i].data():null,name=profile?.publicName;
   if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw Error('public-name-unavailable');
   return {uid,name:name.trim(),ladderPoints:ladder.get(uid).points,hunterTier:rows.get(uid)?.tier??null};
  });
  return {complete:true,players,hunterGeneration:generation};
 };
}
module.exports={createPublicPlayerReader};
