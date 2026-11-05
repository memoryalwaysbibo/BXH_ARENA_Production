'use strict';
const {createHash}=require('node:crypto');
const BASELINE='4b7944b6c239aff6bedf7cc1ddd16e8be915d7abdbcbd2e1c61ccd5454e0a258';
const hash=s=>createHash('sha256').update(s).digest('hex');
function patch(source){
 if(hash(source)!==BASELINE)throw Error('source-drift: recapture the deployed ladderAutoSettlement source');
 const edits=[
  ["        const row=plan.rows[i],profile=profiles[row.uid]||{},prior=priorTxSnaps[i],playerSnap=playerSnaps[i];", "        const row=plan.rows[i],profile=profiles[row.uid]||{},prior=priorTxSnaps[i],playerSnap=playerSnaps[i];\n        const playerName=typeof profile.realName==='string'?profile.realName.trim()||'—':'—';"],
  ['playerUid:row.uid,playerName:row.playerName,pointsEarned:', 'playerUid:row.uid,playerName,pointsEarned:'],
  ['playerName:String(row.playerName||profile.realName||profile.displayName||profile.nickname||row.uid),','playerName,']
 ];
 for(const [before,after] of edits){if(source.split(before).length!==2)throw Error('patch-shape-mismatch');source=source.replace(before,after);}
 return source;
}
module.exports={patch,hash,BASELINE};
