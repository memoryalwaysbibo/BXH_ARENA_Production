'use strict';
// Candidate allocation only: existing preview publication is unchanged.
// Rank waiting together so crossing T0 locally doesn't require a full refetch.
function allocateLobbyPreview(cards,{limit=20}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>20||!Array.isArray(cards))throw Error('preview-input');
 const groups={live:[],waiting:[],settling:[],ended:[]};
 for(const card of cards){
  const key=card.eventPhase==='done'||card.eventPhase==='cancelled'?'ended':
   card.eventPhase==='live'||card.eventPhase==='settling'?card.eventPhase:'waiting';
  groups[key].push(card);
 }
 const cmp=(a,b)=>{
  const aKnown=Number.isFinite(a.eventAt),bKnown=Number.isFinite(b.eventAt);
  return aKnown!==bKnown?(aKnown?-1:1):aKnown&&a.eventAt!==b.eventAt?b.eventAt-a.eventAt:a.id.localeCompare(b.id);
 };
 for(const rows of Object.values(groups))rows.sort(cmp);
 // The existing lobby renders at most five ended cards. Historical records
 // never displace open/waiting, live, or settling cards.
 groups.ended=groups.ended.slice(0,5);
 const first=[],sections={};
 for(const [key,rows] of Object.entries(groups)){
  const selected=rows.slice(0,Math.max(0,limit-first.length));first.push(...selected);
  sections[key]={shown:selected.length,total:rows.length,more:selected.length<rows.length};
 }
 return {first,sections,complete:Object.values(sections).every(section=>!section.more)};
}
module.exports={allocateLobbyPreview};
