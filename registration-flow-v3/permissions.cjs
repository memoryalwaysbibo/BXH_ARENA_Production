'use strict';
const Access=require('../qr-checkin/backend/overlays/room-access-core.js');
const Staff=require('../management-summary/functions/event-staff-core.cjs');
const epoch=x=>x?.toMillis?x.toMillis():Number(x)||0;
const active=Access.active;
function parseRoom(room){
 try{const s=JSON.parse(room.data);if(!s?.meta||!Array.isArray(s.players)||!Array.isArray(s.matches))return null;return s;}catch{return null;}
}
function mutable(room){
 const s=parseRoom(room);
 return !!s&&room.tournamentPhase==='waiting'&&!room.systemClosed&&!room.eventCancelled&&!room.deletionStatus&&
  !s.meta.eventCancelled&&!s.startedAt&&!s.bracketSize&&!s.matches.length&&
  ![room.archiveStatus,s.archiveStatus].some(v=>['completed','archived'].includes(v));
}
function canReview({user,uid,room,now}){
 if(!active(user)||user.isTestAccount===true||!mutable(room))return false;
 const s=parseRoom(room);
 if(['super_admin','admin'].includes(user.role))return true;
 if(Access.isOwner(uid,room)&&user.role==='player')return true;
 if(Staff.ownsEvent(user,uid,room,now))return true;
 const assignments=[...(Array.isArray(room.assignedStaffUids)?room.assignedStaffUids:[]),
  ...(Array.isArray(s.meta.assignedStaffUids)?s.meta.assignedStaffUids:[])];
 return user.role==='staff'&&(assignments.includes(uid)||[room.ownerUid,room.createdBy,s.meta.ownerUid,s.meta.createdBy].includes(uid));
}
function createAuthorizers({db}){
 return {
  async authorizeJoin({tx,uid,user,room,registrationId,now,code}){
   if(!active(user)||uid!==registrationId||!mutable(room))return false;
   if(room.registrationEnabled!==true||room.visibility!=='public'||room.registrationVisibility!=='public'||!room.publishedAt)return false;
   const start=epoch(room.registrationOpenAt),end=epoch(room.registrationCloseAt);
   if(!start||!end||now<start||now>=end)return false;
   if(!user.realName||typeof user.phone!=='string'||!(user.profileCompleted||['staff','admin','super_admin','tester'].includes(user.role)))return false;
   if(Access.normalizeMode(room.roomAccessMode)==='password'&&!Access.canBypass(uid,user,room)){
    const [grant]=await tx.getAll(db.doc('tournaments/'+code+'/accessGrants/'+uid));
    if(!Access.grantValid(grant.data(),room,now))return false;
   }
   return true;
  },
  authorizeReview:canReview,
  authorizeCancel(ctx){
   if(!active(ctx.user)||!mutable(ctx.room))return false;
   if(ctx.uid===ctx.registrationId){const deadline=epoch(ctx.room.cancellationDeadline);return !!deadline&&ctx.now<deadline;}
   return canReview(ctx);
  }
 };
}
module.exports={createAuthorizers,canReview,mutable};
