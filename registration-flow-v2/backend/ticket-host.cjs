'use strict';

const isPartnerRoomCode=code=>typeof code==='string'&&/^PTN-[A-Z0-9]{6}$/.test(code);
const validRegistrationRoomCode=code=>typeof code==='string'&&(/^BXH-[A-Z0-9]{4,16}$/.test(code)||isPartnerRoomCode(code));
const ticketLifecyclePath=code=>isPartnerRoomCode(code)
 ?'systemSettings/commerceTicketPtnPilotV1':'systemSettings/commerceTicketLifecycleV1';

function grantTime(value){
 if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!value.trim()))return NaN;
 const n=Number(value);
 return Number.isFinite(n)?n:Date.parse(value);
}

function ticketHostGrant(user,now){
 const g=user?.partnerOrganizer;
 if(user?.active!==true||user.role!=='player'||user.deleted||user.isTestAccount||
    ['deleted','disabled','frozen'].includes(user.accountStatus)||g?.status!=='active'||
    typeof g.organizationId!=='string'||!g.organizationId.trim())return null;
 const rawStart=g.startsAtMs??g.startsAt;
 const startsAt=rawStart==null&&g.scope!=='contract'?0:grantTime(rawStart);
 const expiresAt=grantTime(g.expiresAtMs??g.expiresAt);
 if(!Number.isFinite(startsAt)||startsAt<0||startsAt>now||!Number.isFinite(expiresAt)||expiresAt<=now)return null;
 const order=g.orderCode||user.partnerContractOrderCode||null;
 if(g.scope==='contract'?typeof order!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/).test(order)
   :!!order||(g.scope!=null&&g.scope!=='manual'))return null;
 const organizationName=typeof g.organizationName==='string'?g.organizationName.trim().slice(0,80):'';
 return {organizationId:g.organizationId,organizationName,order,startsAt,expiresAt};
}

function activeTicketManager(user){
 return user?.active===true&&!user.deleted&&!user.isTestAccount&&
  !['deleted','disabled','frozen'].includes(user.accountStatus);
}

// A delegate's authority belongs to one private PTN room, never to the
// organization or to other rooms owned by the same organizer.
async function authorizeTicketManager(tx,db,{uid,user,room,gate,code,now}){
 if(!activeTicketManager(user)||room?.eventAuthority!=='ticket'||room.createdByRole!=='partner_organizer'||
    typeof room.ownerUid!=='string'||room.createdBy!==room.ownerUid||
    gate?.ownerUid!==room.ownerUid||gate.roomCode!==code||
    room.ticketAccessV1?.ownerUid!==room.ownerUid||
    room.ticketAccessV1?.roomId!==gate.roomId)throw Error('permission-denied');
 const owner=uid===room.ownerUid;
 const admin=user.role==='super_admin';
 const delegate=isPartnerRoomCode(code)&&user.role==='player'&&room.ptnDelegateUid===uid;
 if(!owner&&!admin&&!delegate)throw Error('permission-denied');
 const ownerUser=owner?user:(await tx.get(db.doc('users/'+room.ownerUid))).data();
 const grant=ticketHostGrant(ownerUser,now);
 if(!grant||room.partnerOrganizationCode!==grant.organizationId||
    (room.partnerContractOrderCode||null)!==grant.order)throw Error('permission-denied');
 return {grant,ownerUid:room.ownerUid,owner,admin,delegate};
}

function checkTicketContract(contract,grant,uid){
 if(!grant.order)return;
 if(contract?.orderCode!==grant.order||contract.targetUid!==uid||contract.status!=='active'||
    contract.signedBy!==uid||!contract.signatureHash||!contract.signedAt||
    grantTime(contract.startsAt)!==grant.startsAt||grantTime(contract.expiresAt)!==grant.expiresAt)throw Error('permission-denied');
}

module.exports={ticketHostGrant,checkTicketContract,isPartnerRoomCode,validRegistrationRoomCode,ticketLifecyclePath,authorizeTicketManager,activeTicketManager};
