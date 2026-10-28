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

// Calendar days in Taiwan; compact buckets keep reads independent of receipt history size.
const DAY=86400000,TAIPEI_OFFSET=8*3600000;
function activityDay(at){if(!Number.isSafeInteger(at)||at<0)throw Error('invalid-activity-time');return Math.floor((at+TAIPEI_OFFSET)/DAY);}
function recentActivity({dailyActivity={},members,now}){
 const today=activityDay(now),active=new Set(),current=new Set(members);let participations=0;
 for(const [key,b] of Object.entries(dailyActivity)){
  const day=Number(key);if(!Number.isSafeInteger(day)||day<today-29||day>today)continue;
  if(!Number.isSafeInteger(b?.participations)||b.participations<0||!Array.isArray(b.memberUids))throw Error('invalid-activity-bucket');
  participations+=b.participations;
  for(const uid of b.memberUids)if(current.has(uid))active.add(uid);
 }
 if(!Number.isSafeInteger(participations))throw Error('invalid-activity-count');
 return {participations,activeMemberCount:active.size,days:30};
}
function recordDailyActivity({dailyActivity={},uid,archivedAt,now,members}){
 const today=activityDay(now),day=activityDay(archivedAt),next={},current=new Set(members);
 if(archivedAt>now)throw Error('future-activity');
 recentActivity({dailyActivity,members:[],now});
 for(const [key,b] of Object.entries(dailyActivity))if(Number(key)>=today-29&&Number(key)<=today)next[key]={participations:b.participations,memberUids:[...new Set(b.memberUids)].filter(id=>current.has(id))};
 if(day>=today-29){const b=next[day]||{participations:0,memberUids:[]};if(b.participations>=Number.MAX_SAFE_INTEGER)throw Error('invalid-activity-count');next[day]={participations:b.participations+1,memberUids:[...new Set([...b.memberUids,uid])]};}
 return next;
}
module.exports.recentActivity=recentActivity;
module.exports.recordDailyActivity=recordDailyActivity;
