'use strict';
const {browseLobby}=require('./lobby.cjs');
const {progression}=require('./progression.cjs');
const presets=require('./emblem-presets.js');
const {admissionPolicy}=require('./admission.cjs');
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
   // Narrow first using server-maintained public summaries; verify authoritative
   // team state only for this page. Counts are an upper bound until verified.
   const candidates=publicDocs.docs.map(s=>{const p=s.data();return {id:s.id,name:p.name,captainName:p.captainName,level:p.level,capacity:p.capacity,memberCount:p.memberCount,strength:p.strength,createdAt:p.createdAt,admission:p.admission,projection:p};});
   const selected=browseLobby(candidates,options,{membershipTeamId:membership?.teamId??null});
   const checked=await Promise.all(selected.items.map(async p=>({p,team:await read(tx,'teamsV1/'+p.id)})));
   let stale=0;const items=[];
   for(const {p,team} of checked){
    const projection=p.projection;
    const fresh=team&&team.status!=='dissolved'&&projection.hunterGeneration===board.generation&&projection.ladderSeason===ladder.currentSeason&&Array.isArray(projection.members)&&Array.isArray(team.memberUids)&&projection.members.length===team.memberUids.length&&projection.members.every((m,j)=>m.uid===team.memberUids[j]&&m.role===(m.uid===team.captainUid?'captain':team.roles?.[m.uid]||'member'));
    let consistent=false;
    if(fresh){try{const level=progression(team.totalXp);consistent=projection.name===team.name&&projection.level===level.level&&projection.capacity===level.capacity&&projection.memberCount===team.memberUids.length&&JSON.stringify(admissionPolicy(projection.admission))===JSON.stringify(admissionPolicy(team.admission));}catch{consistent=false;}}
    if(!consistent){stale++;continue;}
    const {projection:discard,...safe}=p;const unlocked=progression(team.totalXp).unlockedFrames;
    const hasEmblem=typeof team.emblemObject==='string'&&team.emblemObject.startsWith('teamEmblemsV1/'+p.id+'/')&&/^teamEmblemsV1\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\.webp$/.test(team.emblemObject);
    items.push({...safe,selectedFrame:unlocked.includes(team.selectedFrame)?team.selectedFrame:null,preset:team.emblemObject?null:presets.normalize(team.emblemPreset??undefined),hasEmblem});
   }
   if(!membership?.teamId){
    const apps=await Promise.all(items.map(p=>read(tx,'teamsV1/'+p.id+'/applications/'+actorUid)));
    for(let i=0;i<items.length;i++)if(apps[i]?.status==='pending')items[i]={...items[i],join:{label:'審核中',disabled:true,action:null}};
   }
   // Only the selected page has been checked; a count from all summaries is
   // not an exact number of currently valid teams.
   return {items,total:selected.total,partial:stale>0||selected.total>selected.items.length,staleCount:stale,totalIsUpperBound:true};
  });
 };
}
module.exports={createListService,MAX_SCAN};
