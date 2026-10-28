'use strict';
const {createPublicPlayerReader}=require('./player-reader.cjs');
function createEligibilityReader({db}){
 const read=createPublicPlayerReader({db});
 return async({tx,uid})=>{const r=await read({tx,uids:[uid]}),p=r.players[0];return {uid,points:p.ladderPoints,tier:p.hunterTier};};
}
function createDisplayNameReader({db}){
 return async({tx,uid})=>{const s=await tx.get(db.doc('publicPlayers/'+uid)),name=s.exists?s.data()?.publicName:null;return typeof name==='string'&&name.trim()&&name.trim().length<=80?name.trim():null;};
}
module.exports={createEligibilityReader,createDisplayNameReader};
