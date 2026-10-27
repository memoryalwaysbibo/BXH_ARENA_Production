'use strict';
const WINDOW=30*86400000;
// Input must be server-projected archive receipts, never browser-supplied results.
// This reducer does not award XP or read live rooms. Duplicate receipts are counted once.
function summarizeActivity({teamId,members,receipts,now}){
 if(typeof teamId!=='string'||!Number.isSafeInteger(now)||!Array.isArray(members)||!Array.isArray(receipts))throw Error('invalid-input');
 if(new Set(members).size!==members.length)throw Error('duplicate-member');
 const current=new Set(members),stats=new Map(members.map(uid=>[uid,{uid,experienceContribution:0,recentParticipations:0}]));
 const seen=new Map();let totalContribution=0,recentParticipations=0;const active=new Set();
 for(const r of receipts){
  if(r.teamId!==teamId)continue;
  if(typeof r.eventId!=='string'||!r.eventId||typeof r.uid!=='string'||!r.uid||r.archived!==true||r.ranked!==true||r.completed!==true||!Number.isSafeInteger(r.archivedAt)||r.archivedAt<0||r.archivedAt>now)throw Error('invalid-archive-receipt');
  const key=JSON.stringify([r.eventId,r.uid]);const stamp=JSON.stringify([r.teamId,r.archivedAt]);
  if(seen.has(key)){if(seen.get(key)!==stamp)throw Error('conflicting-receipt');continue;}seen.set(key,stamp);
  totalContribution++;
  const recent=r.archivedAt>=now-WINDOW;
  if(recent)recentParticipations++;
  if(current.has(r.uid)){
   const s=stats.get(r.uid);s.experienceContribution++;if(recent){s.recentParticipations++;active.add(r.uid);}
  }
 }
 return {totalContribution,recentParticipations,activeMemberCount:active.size,memberCount:members.length,members:[...stats.values()]};
}
function presenceView({viewerIsMember,lastSeenAt,now}){
 if(!viewerIsMember)return null;
 if(lastSeenAt==null)return {state:'unknown',label:'尚無紀錄'};
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(lastSeenAt)||lastSeenAt<0||lastSeenAt>now) return {state:'unknown',label:'尚無紀錄'};
 const delta=now-lastSeenAt;
 // Last-seen timestamps alone cannot prove a currently connected session.
 const label=delta<60000?'剛剛':delta<3600000?Math.floor(delta/60000)+' 分鐘前':delta<86400000?Math.floor(delta/3600000)+' 小時前':Math.floor(delta/86400000)+' 天前';
 return {state:'last-seen',label};
}
module.exports={summarizeActivity,presenceView};
