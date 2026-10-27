'use strict';
const {progression}=require('./progression.cjs');
const MAX_SCAN=200,MAX_PAGE=50;
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
function createRankingService({db}){
 const read=async(tx,path)=>{const s=await tx.get(db.doc(path));return s.exists?s.data():null;};
 return async({actorUid,query={}})=>{
  if(!validId(actorUid)||!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!['offset','limit'].includes(k)))throw Error('invalid-ranking-query');
  const offset=query.offset??0,limit=query.limit??20;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)throw Error('invalid-ranking-query');
  return db.runTransaction(async tx=>{
   const [board,ladder,docs]=await Promise.all([read(tx,'hunterLeaderboardMeta/current'),read(tx,'ladderSystem/current'),tx.get(db.collection('teamsPublicV1').limit(MAX_SCAN+1))]);
   if(!board?.generation||!ladder?.currentSeason)throw Error('source-unavailable');
   if(docs.docs.length>MAX_SCAN)throw Error('team-list-capacity-exceeded');
   const rows=await Promise.all(docs.docs.map(async doc=>({id:doc.id,p:doc.data(),team:await read(tx,'teamsV1/'+doc.id)})));
   let excluded=0;const valid=[];
   for(const {id,p,team} of rows){
    let ok=!!team&&team.status==='active'&&p.hunterGeneration===board.generation&&p.ladderSeason===ladder.currentSeason&&p.strengthComplete===true&&Number.isFinite(p.strength)&&p.strength>=0&&Array.isArray(p.members)&&Array.isArray(team.memberUids)&&p.members.length===team.memberUids.length;
    if(ok)ok=p.members.every((m,i)=>m.uid===team.memberUids[i]&&m.role===(m.uid===team.captainUid?'captain':team.roles?.[m.uid]||'member')&&Number.isFinite(m.ladderPoints)&&m.ladderPoints>=0);
    if(ok)try{ok=p.name===team.name&&p.memberCount===team.memberUids.length&&p.level===progression(team.totalXp).level&&p.strength===p.members.reduce((sum,m)=>sum+m.ladderPoints,0);}catch{ok=false;}
    if(!ok){excluded++;continue;}
    const unlocked=progression(team.totalXp).unlockedFrames;
    valid.push({id,name:p.name,captainName:p.captainName,level:p.level,memberCount:p.memberCount,strength:p.strength,selectedFrame:unlocked.includes(team.selectedFrame)?team.selectedFrame:null});
   }
   valid.sort((a,b)=>b.strength-a.strength||a.id.localeCompare(b.id));
   for(let i=0;i<valid.length;i++)valid[i].rank=i>0&&valid[i].strength===valid[i-1].strength?valid[i-1].rank:i+1;
   return {items:valid.slice(offset,offset+limit),total:valid.length,excluded,partial:excluded>0,offset,limit};
  });
 };
}
module.exports={createRankingService,MAX_SCAN,MAX_PAGE};
