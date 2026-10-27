'use strict';
const {browseLobby}=require('./lobby.cjs');
// Bounded candidate for small installations; explicitly fails above cap instead of silently omitting teams.
const MAX_SCAN=200;
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
function createListService({db}){
 const read=async(tx,path)=>{const s=await tx.get(db.doc(path));return s.exists?s.data():null;};
 return async({actorUid,query={}})=>{
  if(!validId(actorUid)||!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!['query','mode','recruitment','offset','limit'].includes(k))||typeof(query.query??'')!=='string'||(query.query??'').length>100)throw Error('invalid-list-query');
  const options={query:query.query??'',mode:query.mode??'all',recruitment:query.recruitment??'all',offset:query.offset??0,limit:query.limit??20};
  return db.runTransaction(async tx=>{
   const [board,ladder,membership,publicDocs]=await Promise.all([
    read(tx,'hunterLeaderboardMeta/current'),read(tx,'ladderSystem/current'),read(tx,'teamMembershipsV1/'+actorUid),tx.get(db.collection('teamsPublicV1').limit(MAX_SCAN+1))
   ]);
   if(!board?.generation||!ladder?.currentSeason)throw Error('source-unavailable');
   if(publicDocs.docs.length>MAX_SCAN)throw Error('team-list-capacity-exceeded');
   const teams=await Promise.all(publicDocs.docs.map(s=>read(tx,'teamsV1/'+s.id)));
   let stale=0;const eligible=[];
   for(let i=0;i<publicDocs.docs.length;i++){
    const snap=publicDocs.docs[i],p=snap.data(),team=teams[i];
    if(!team||team.status==='dissolved')continue;
    const fresh=p.hunterGeneration===board.generation&&p.ladderSeason===ladder.currentSeason&&Array.isArray(p.members)&&Array.isArray(team.memberUids)&&p.members.length===team.memberUids.length&&p.members.every((m,j)=>m.uid===team.memberUids[j]&&m.role===(m.uid===team.captainUid?'captain':team.roles?.[m.uid]||'member'));
    if(!fresh){stale++;continue;}
    // projection write is server only; allowlist excludes player UIDs and member details.
    eligible.push({id:snap.id,name:p.name,captainName:p.captainName,level:p.level,capacity:p.capacity,memberCount:p.memberCount,strength:p.strength,createdAt:p.createdAt,admission:p.admission});
   }
   const result=browseLobby(eligible,options,{membershipTeamId:membership?.teamId??null});
   if(!membership?.teamId){
    const apps=await Promise.all(result.items.map(p=>read(tx,'teamsV1/'+p.id+'/applications/'+actorUid)));
    result.items=result.items.map((p,i)=>apps[i]?.status==='pending'?{...p,join:{label:'審核中',disabled:true,action:null}}:p);
   }
   return {...result,partial:stale>0,staleCount:stale};
  });
 };
}
module.exports={createListService,MAX_SCAN};
