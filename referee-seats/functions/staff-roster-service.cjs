'use strict';

const activeStaff=user=>user?.active===true&&user.role==='staff'&&user.isTestAccount!==true&&
 !user.deleted&&!['deleted','disabled','frozen'].includes(user.accountStatus);
const nameOf=row=>String(row.publicName||row.displayName||row.name||row.realName||'').trim();
const timeOf=value=>Number(value?.toMillis?.()??value)||0;

// This is a display projection only: no player identities, contact information,
// registration documents, or tournament write authority leave this boundary.
function projectStaffRoster(room,registrations){
 const state=typeof room.data==='string'?JSON.parse(room.data):room.data;
 if(!state||typeof state!=='object'||Array.isArray(state))throw Error('corrupt-state');
 const canonical=(items,status)=>(Array.isArray(items)?items:[]).filter(row=>row&&!['cancelled','withdrawn','not_selected'].includes(row.status)).map(row=>({
  name:nameOf(row),status,checkedIn:row.checkedIn===true,source:row.source==='online'?'online':'onsite'
 })).filter(row=>row.name);
 // Drawn, started, selection, and onsite-managed rosters must retain the
 // authoritative tournament result rather than reconstructing registrations.
 if(state.startedAt||state.bracketSize||state.matches?.length||state.entrySelection||room.registrationSelection||
    room.onsiteWaitlistServerOwned===true||state.onsiteWaitlistFinalized===true||
    state.meta?.registrationOnsiteWaitlistEnabled===true){
  return canonical(state.players,'confirmed').concat(canonical(state.waitlistPlayers,'waitlist'));
 }
 const old=new Map((state.players||[]).filter(Boolean).map(row=>[
  String(row.registrationId||'')+':'+String(row.teamMemberSlot||''),row
 ]));
 const rows=[];
 for(const registration of [...registrations].sort((a,b)=>timeOf(a.createdAt)-timeOf(b.createdAt)||a.registrationId.localeCompare(b.registrationId))){
  if(!['confirmed','waitlist'].includes(registration.status))continue;
  const team=registration.registrationKind==='team'||(registration.teamId&&Array.isArray(registration.teamMembers));
  const members=team?registration.teamMembers:[registration];
  for(const [index,member]of (Array.isArray(members)?members:[]).entries()){
   const name=team?String(member.name||'').trim():nameOf(member);
   if(!name)throw Error('registration-name-missing');
   const previous=old.get(registration.registrationId+':'+(team?String(member.slot||index+1):''));
   rows.push({name,status:registration.status,source:'online',
    checkedIn:previous?.checkedIn===true||(!previous&&state.meta?.checkinRequired!==true)});
  }
 }
 const locals=(items,status)=>canonical((items||[]).filter(row=>row&&row.source!=='online'&&!row.registrationId),status);
 return locals(state.players,'confirmed').concat(rows,locals(state.waitlistPlayers,'waitlist'));
}

function createStaffRosterHandler(db){return async request=>{
 const uid=request.auth?.uid;
 if(!uid)throw Error('unauthenticated');
 const code=String(request.data?.code||'').trim().toUpperCase();
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
 // A transaction gives the display one consistent room/profile/registration
 // snapshot. It never writes or promotes anyone, even when the roster is stale.
 return db.runTransaction(async tx=>{
  const [user,room]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(db.doc('tournaments/'+code))]);
  if(!user.exists||!activeStaff(user.data()))throw Error('permission-denied');
  if(!room.exists)throw Error('not-found');
  const data=room.data();
  if(data.eventAuthority!=='official'||data.testMode===true||data.createdByRole==='tester')throw Error('permission-denied');
  const registrations=await tx.get(db.collection('tournaments/'+code+'/registrations'));
  const rows=projectStaffRoster(data,registrations.docs.map(doc=>({...doc.data(),registrationId:doc.id})));
  return {ok:true,code,rows};
 });
};}

module.exports={activeStaff,projectStaffRoster,createStaffRosterHandler};
