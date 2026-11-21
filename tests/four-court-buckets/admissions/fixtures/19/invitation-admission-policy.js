'use strict';

const fail=()=>{throw Error('registration-state-conflict');};
function count(value){
 const number=value??0;
 if(!Number.isSafeInteger(number)||number<0)fail();
 return number;
}
function runtime(t){
 if(t.data===undefined)return {};
 let s;try{s=typeof t.data==='string'?JSON.parse(t.data):t.data;}catch{fail();}
 if(!s||typeof s!=='object'||Array.isArray(s))fail();
 for(const field of ['players','waitlistPlayers'])if(s[field]!==undefined&&!Array.isArray(s[field]))fail();
 return s;
}
function localCount(players){
 return (players||[]).filter(p=>p&&p.source!=='online'&&!p.registrationId&&(!p.status||['confirmed','waitlist'].includes(p.status))).length;
}

// Called only inside the invitation acceptance transaction, from its current
// private/public room snapshots. Invitations reserve no slot and cannot bypass
// either online or local waitlists, including when automatic filling is off.
// This does not reopen online registration or alter draw-managed admission.
function ordinaryInvitationAdmission(t,pub){
 const s=runtime(t);
 const marked=t.communityQuickRegistration===true||pub.communityQuickRegistration===true;
 const quick=t.communityQuickRegistration===true&&pub.communityQuickRegistration===true&&
  t.eventAuthority==='community'&&pub.eventAuthority==='community';
 if(marked&&(!quick||t.battleMode==='team'||pub.battleMode==='team'||s.meta?.battleMode==='team'))fail();
 const capacity=t.capacity;
 const unlimited=quick&&capacity===null&&pub.capacity===null;
 if(!unlimited&&(!Number.isSafeInteger(capacity)||capacity<1))throw Error('invalid-registration-capacity');
 if(pub.capacity!==undefined&&pub.capacity!==capacity)fail();
 const confirmed=count(t.confirmedCount),waiting=count(t.waitlistCount);
 if(pub.confirmedCount!==undefined&&count(pub.confirmedCount)!==confirmed)fail();
 if(pub.waitlistCount!==undefined&&count(pub.waitlistCount)!==waiting)fail();
 // Team registrations count teams, not individual runtime member rows. Retain
 // their existing counter units; this patch does not introduce team invitations.
 const team=t.battleMode==='team'||pub.battleMode==='team'||s.meta?.battleMode==='team';
 const occupied=confirmed+(team?0:localCount(s.players));
 const waitlistCount=waiting+(team?0:localCount(s.waitlistPlayers));
 if(!Number.isSafeInteger(occupied)||!Number.isSafeInteger(waitlistCount))fail();
 // Existing waiting participants retain priority even after capacity increases.
 if(waitlistCount===0&&(unlimited||occupied<capacity))return {status:'confirmed',field:'confirmedCount'};
 const waitlistCapacity=count(t.waitlistCapacity);
 if(t.waitlistEnabled!==true||waitlistCount>=waitlistCapacity)throw Error('full');
 return {status:'waitlist',field:'waitlistCount'};
}

module.exports={ordinaryInvitationAdmission};
