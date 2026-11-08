'use strict';

const registrationIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const matchesId=(pattern,value)=>typeof value==='string'&&pattern.test(value);
const absent=value=>value===undefined||value==='';

function managementOperation(data){
 const {action,code,operationId,registrationId,localId,expandBy,enabled}=data;
 const operation={code,operationId};
 const payload={code,operationId,action,intent:'admin'};
 if(action==='cancel'&&Object.keys(data).every(key=>['action','code','operationId','registrationId','localId'].includes(key))){
  if(matchesId(registrationIdPattern,registrationId)&&absent(localId))return {...operation,route:'roster',payload:{...payload,registrationId}};
  if(matchesId(registrationIdPattern,localId)&&absent(registrationId))return {...operation,route:'roster',payload:{...payload,localId}};
 }
 if(action==='configure'&&typeof enabled==='boolean'&&Object.keys(data).every(key=>['action','code','operationId','enabled'].includes(key))){
  return {...operation,route:'roster',payload:{...payload,enabled}};
 }
 if(action==='promoteLocal'&&matchesId(/^[A-Za-z0-9_-]{1,200}$/,localId)&&Object.keys(data).every(key=>['action','code','operationId','localId','expandBy'].includes(key))&&[0,8].includes(expandBy??0)){
  return {...operation,route:'promotion',payload:{...payload,localId,expandBy:expandBy??0}};
 }
 if(action==='demote'&&matchesId(registrationIdPattern,registrationId)&&Object.keys(data).every(key=>['action','code','operationId','registrationId'].includes(key))){
  return {...operation,route:'promotion',payload:{...payload,registrationId}};
 }
 if(action==='promote'&&Object.keys(data).every(key=>['action','code','operationId','registrationId','expandBy'].includes(key))&&[0,8].includes(expandBy??0)){
  if(matchesId(registrationIdPattern,registrationId))return {...operation,route:'promotion',payload:{...payload,registrationId,expandBy:expandBy??0}};
 }
 throw Error('invalid-operation');
}

// Only this management entry point can enqueue staff actions. The authorizer
// runs on the same transaction as admission; the writer checks again on execution.
function createManagementApi({queue,authorize,enabled=async()=>false}){
 if(typeof authorize!=='function')throw Error('queue-management-authorizer-required');
 return async req=>{
  const uid=req.auth?.uid,data=req.data||{};
  if(!uid)throw Error('auth-required');
  if(data.action==='status')return queue.status(uid,data.code,data.operationId);
  const operation=managementOperation(data);
  if(!await enabled(operation.code))throw Error('registration-queue-disabled');
  return queue.enqueue(uid,operation,authorize);
 };
}

function createManagementAuthorizer({db,canCancel,canPromote,canPromoteUnlimited}){
 return async (tx,user,operation)=>{
  const room=(await tx.get(db.doc('tournaments/'+operation.code))).data();
  if(!room)throw Error('not-found');
  const runtime=typeof room.data==='string'?JSON.parse(room.data):room.data||{};
  const uid=operation.uid;
  const permitted=operation.route==='roster'?canCancel(user,uid,room,runtime):
   isUnlimitedRoom(room)?canPromoteUnlimited(user,uid,room):canPromote(user,uid,room);
  if(!permitted)throw Error('permission-denied');
 };
}

const isUnlimitedRoom=room=>room?.eventAuthority==='community'&&room.communityQuickRegistration===true&&room.capacity===null;

// Adapt the existing trusted promotion writer without passing client-selected
// fields through to it. It must execute its mutation through the fenced store.
function createQueuedPromotion({promote,roster}){
 return db=>async req=>{
  const {code,operationId,registrationId,localId,action,expandBy}=req.data;
  const [room,mirror]=await db.getAll(db.doc('tournaments/'+code),db.doc('publicTournaments/'+code));
  if(isUnlimitedRoom(room.data())&&isUnlimitedRoom(mirror.data())){
   if(action!=='promote'||expandBy!==0)throw Error('promotion-route-not-supported');
   return roster(db)(req);
  }
  const target=action==='promoteLocal'?{localId,expandBy}:{registrationId,...(action==='demote'?{action}:{expandBy})};
  return promote(db)({auth:req.auth,data:{code,operationId,...target}});
 };
}

module.exports={createManagementApi,createManagementAuthorizer,createQueuedPromotion};
