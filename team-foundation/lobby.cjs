'use strict';
const {progression}=require('./progression.cjs');
const {admissionPolicy,TIERS}=require('./admission.cjs');
function publicTeam(team,players){
 const p=progression(team.totalXp),policy=admissionPolicy(team.admission);
 // Explicit allowlist; no presence, contribution, history, reasons or application data.
 return {id:team.id,name:team.name,captainName:players[team.captainUid]?.name??'未提供',level:p.level,capacity:p.capacity,memberCount:team.memberUids.length,strength:team.memberUids.reduce((n,uid)=>n+(Number.isFinite(players[uid]?.ladderPoints)?players[uid].ladderPoints:0),0),createdAt:team.createdAt,admission:policy,
 members:team.memberUids.map(uid=>({uid,name:players[uid]?.name??'未提供',role:uid===team.captainUid?'captain':team.roles?.[uid]??'member',ladderPoints:Number.isFinite(players[uid]?.ladderPoints)?players[uid].ladderPoints:null,hunterTier:TIERS.includes(players[uid]?.hunterTier)?players[uid].hunterTier:null}))};
}
function eligibility(team,player){
 const p=team.admission;
 if(p.minPoints!==null&&!Number.isFinite(player?.ladderPoints)||p.minTier!==null&&!TIERS.includes(player?.hunterTier))return null;
 return (p.minPoints===null||player.ladderPoints>=p.minPoints)&&(p.minTier===null||TIERS.indexOf(player.hunterTier)>=TIERS.indexOf(p.minTier));
}
function joinState(team,{membershipTeamId=null,pendingTeamIds=[],player=null}={}){
 if(membershipTeamId===team.id)return {label:'我的戰隊',disabled:false,action:'view'};
 if(membershipTeamId)return {label:'已有所屬戰隊',disabled:true,action:null};
 if(pendingTeamIds.includes(team.id))return {label:'審核中',disabled:true,action:null};
 if(team.memberCount>=team.capacity)return {label:'已滿員',disabled:true,action:null};
 if(team.admission.mode==='auto'){
  const ok=eligibility(team,player);
  if(ok===null)return {label:'資格待確認',disabled:true,action:null};
  if(!ok)return {label:'未達條件',disabled:true,action:null};
 }
 return {label:'加入',disabled:false,action:team.admission.mode==='auto'?'join':'apply'};
}
// Only filter already-public records. Real discovery requires a bounded server query adapter.
function browseLobby(teams,{query='',recruitment='all',mode='all',eligibleOnly=false,minLevel=1,maxLevel=10,pendingOnly=false,sort='strength',offset=0,limit=20}={},viewer={}){
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(minLevel)||!Number.isInteger(maxLevel)||minLevel<1||maxLevel>10||minLevel>maxLevel)throw Error('invalid-pagination-or-level');
 if(!['all','open','full'].includes(recruitment)||!['all','auto','review'].includes(mode)||!['strength','level','newest'].includes(sort))throw Error('invalid-filter');
 const needle=query.trim().normalize('NFKC').toLocaleLowerCase();
 const filtered=teams.filter(t=>{
  const full=t.memberCount>=t.capacity;
  return (!needle||[t.name,t.captainName].some(s=>String(s).normalize('NFKC').toLocaleLowerCase().includes(needle)))&&(recruitment==='all'||(recruitment==='full'?full:!full))&&(mode==='all'||t.admission.mode===mode)&&t.level>=minLevel&&t.level<=maxLevel&&(!pendingOnly||viewer.pendingTeamIds?.includes(t.id))&&(!eligibleOnly||t.admission.mode==='auto'&&eligibility(t,viewer.player)===true);
 });
 filtered.sort((a,b)=>(sort==='strength'?b.strength-a.strength:sort==='level'?b.level-a.level:b.createdAt-a.createdAt)||a.id.localeCompare(b.id));
 return {total:filtered.length,items:filtered.slice(offset,offset+limit).map(t=>({...t,join:joinState(t,viewer)}))};
}
module.exports={publicTeam,eligibility,joinState,browseLobby};
