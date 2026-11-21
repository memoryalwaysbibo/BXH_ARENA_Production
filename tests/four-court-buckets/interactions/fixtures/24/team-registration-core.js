'use strict';
const {createHash}=require('node:crypto');

const cleanText=(value,max)=>{
  const text=String(value==null?'':value).trim().replace(/\s+/g,' ');
  if(!text || [...text].length>max || /[\u0000-\u001f<>]/.test(text)) throw Error('invalid-team-data');
  return text;
};
function normalizeTeamName(value){ return cleanText(value,40); }
function normalizeTeamMembers(value,teamSize){
  const size=Math.max(3,Number(teamSize)||0);
  if(!Array.isArray(value)||value.length!==size) throw Error('team-size-mismatch');
  return value.map((entry,index)=>{
    const raw=typeof entry==='string'?entry:entry&&entry.name;
    return {slot:index+1,name:cleanText(raw,40)};
  });
}
function allocateTeamStatus({confirmedCount,capacity,waitlistCount,waitlistEnabled,waitlistCapacity}){
  const confirmed=Math.max(0,Number(confirmedCount)||0),cap=Math.max(0,Number(capacity)||0);
  const waiting=Math.max(0,Number(waitlistCount)||0),waitCap=Math.max(0,Number(waitlistCapacity)||0);
  if(cap>0&&confirmed<cap)return {status:'confirmed',confirmedCount:confirmed+1,waitlistCount:waiting};
  if(waitlistEnabled===true&&waiting<waitCap)return {status:'waitlist',confirmedCount:confirmed,waitlistCount:waiting+1};
  throw Error('full');
}
function teamIdFor(code,uid){
  return 'team_'+createHash('sha256').update(String(code)+':'+String(uid)).digest('hex').slice(0,20);
}
function teamMemberPlayerId(teamId,slot){
  return String(teamId)+'_m'+String(slot);
}
module.exports={normalizeTeamName,normalizeTeamMembers,allocateTeamStatus,teamIdFor,teamMemberPlayerId};
