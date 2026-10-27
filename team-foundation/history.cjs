'use strict';
const REASONS=Object.freeze({inactive:'長期未活躍',rules:'違反戰隊規範',adjustment:'隊伍調整',requested:'本人要求協助退出',other:'其他'});
function removalReason(code,note){
 if(!Object.hasOwn(REASONS,code))throw Error('removal-reason-required');
 const text=typeof note==='string'?note.trim():'';
 if(text.length>500)throw Error('reason-too-long');
 if(code==='other'&&!text)throw Error('other-reason-required');
 return {code,label:REASONS[code],note:text};
}
function historyView(record){
 if(!Number.isSafeInteger(record.occurredAt)||record.occurredAt<0)throw Error('invalid-time');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(record.occurredAt);
 const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const role={captain:'隊長',deputy:'副隊長'}[record.actorRole]||'成員';
 const method={create:'建立戰隊',auto:'系統自動加入',approve:role+'－'+record.actorName+'核准',leave:'自行退出',remove:role+'－'+record.actorName+'移除',assign:'職位調整',transfer:'隊長轉讓',dissolve:'隊長解散'}[record.method]||record.method;
 return {name:record.subjectName,date:v.year+'/'+v.month+'/'+v.day,time:v.hour+':'+v.minute,method};
}
// Enforce this again in the real server read endpoint and Rules; UI filtering is insufficient.
function mayReadReason({viewerUid,record,team}){
 return !!viewerUid&&(viewerUid===record.subjectUid||team?.status!=='dissolved'&&team?.memberUids?.includes(viewerUid)&&(team.captainUid===viewerUid||team.roles?.[viewerUid]==='deputy'));
}
module.exports={REASONS,removalReason,historyView,mayReadReason};
