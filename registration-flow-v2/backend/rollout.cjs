'use strict';
const {createBindings}=require('./bindings.cjs');
const validRoom=code=>typeof code==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(code);

// Room migration is separate: these bindings never change room ownership or
// create registrations. Keep the original pilot configuration usable while the
// new rollout configuration is absent, and retain actor-scoped receipts.
function createRolloutBindings({pilotRoom,retiredRoom=null,retiredRooms=[],...dependencies}){
 if(!validRoom(pilotRoom))throw Error('invalid-pilot-room');
 if(!Array.isArray(retiredRooms)||retiredRooms.length>8)throw Error('invalid-retired-room');
 const retired=new Set([...(retiredRoom===null?[]:[retiredRoom]),...retiredRooms]);
 if([...retired].some(code=>!validRoom(code)||code===pilotRoom)||retired.size!==retiredRooms.length+(retiredRoom===null?0:1))throw Error('invalid-retired-room');
 const {db}=dependencies;
 const pilotRef=db.doc('systemSettings/registrationFlowV2Pilot');
 const rolloutRef=db.doc('systemSettings/registrationFlowV2Rollout');
 const read=async(ref,tx)=>(await (tx?tx.get(ref):ref.get())).data();
 const config=async tx=>{
  const [pilot,rollout]=await Promise.all([read(pilotRef,tx),read(rolloutRef,tx)]);
  const codes=rollout?.roomCodes;
  const valid=Array.isArray(codes)&&codes.length<=500&&new Set(codes).size===codes.length&&codes.every(code=>validRoom(code)&&!retired.has(code));
  return {pilot,rollout:valid?rollout:null};
 };
 const pilotAllows=(config,field)=>config?.roomCode===pilotRoom&&config.workersEnabled===true&&config[field]===true;
 const owns=async(code,tx)=>validRoom(code)&&!retired.has(code)&&
  (await read(db.doc('tournaments/'+code),tx))?.registrationQueueVersion===2;
 const roomAllowed=async code=>validRoom(code)&&!retired.has(code)&&(code===pilotRoom||await owns(code));
 const enabled=async(code,tx,field='intakeEnabled')=>{
  if(!validRoom(code)||retired.has(code))return false;
  const {pilot,rollout}=await config(tx);
  // An explicit rollout entry takes precedence, including an explicit stop.
  if(rollout?.roomCodes.includes(code))return rollout.workersEnabled===true&&rollout[field]===true&&await owns(code,tx);
  return code===pilotRoom&&pilotAllows(pilot,field);
 };
 const workerRoomAllowed=async code=>{
  const {pilot,rollout}=await config();
  if(rollout?.roomCodes.includes(code))return rollout.workersEnabled===true&&await owns(code);
  if(code===pilotRoom)return pilotAllows(pilot,'workersEnabled');
  // Removing a room from intake must not strand its already accepted jobs.
  return rollout?.workersEnabled===true&&await owns(code);
 };
 return createBindings({...dependencies,pilotRoom:null,retiredRoom,retiredRooms,stagedOnly:false,
  roomAllowed,workerRoomAllowed,readEnabled:owns,
  workersEnabled:async()=>{const {pilot,rollout}=await config();return rollout?.workersEnabled===true||pilotAllows(pilot,'workersEnabled');},
  enabled,drawEnabled:(code,tx)=>enabled(code,tx,'lifecycleEnabled'),startEnabled:(code,tx)=>enabled(code,tx,'lifecycleEnabled'),
  sweepAllowedRoom:async code=>await roomAllowed(code)&&await workerRoomAllowed(code),
 });
}
module.exports={createRolloutBindings};
