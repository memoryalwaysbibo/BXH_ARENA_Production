'use strict';
// Candidate only. A trusted backend transaction must call this; browser create
// Rules forbid client-written refereeSeatsV1.
const C=require('./functions/core.cjs');
function initialize({state,ownerUid,release}){
 const m=state?.meta||{};
 if(release?.enabled!==true||release?.perCourtScoringVerified!==true)return {ok:false,reason:'release-not-ready'};
 if(m.eventAuthority!=='official'||m.battleMode==='team'||m.playMode==='enchantment'||state?.testMode===true)return {ok:false,reason:'unsupported-mode'};
 if(!ownerUid||typeof ownerUid!=='string')return {ok:false,reason:'invalid-owner'};
 const n=m.stations;
 if(!Number.isSafeInteger(n)||n<1||n>32)return {ok:false,reason:'invalid-stations'};
 if(m.refereeSeatsV1||state.refereeSeatsV1)return {ok:false,reason:'already-enabled'};
 if(Object.values(m.refereeStationAssignments||{}).some(x=>Array.isArray(x)&&x.length))return {ok:false,reason:'legacy-assignments-exist'};
 const model={version:1,revision:1,courts:Object.fromEntries(Array.from({length:n},(_,i)=>[String(i+1),{revision:0,main:null,backup1:null,backup2:null}])),requests:{}};
 const projection=C.project(model,ownerUid,n),assignedStaffUids=[...new Set([...(m.assignedStaffUids||[]),ownerUid])];
 const privateMeta={...m,...projection,assignedStaffUids,refereeSeatsV1:model};
 const publicMeta={...m,refereeStationNames:projection.refereeStationNames,refereeSeatNames:projection.refereeSeatNames,refereeStationRestrictionEnabled:true};
 for(const k of ['assignedStaffUids','refereeSeatsV1','refereeStationAssignments','refereeStationUids'])delete publicMeta[k];
 return {ok:true,model,privateMeta,privateFields:{refereeSeatsV1:model,...projection,assignedStaffUids},publicMeta};
}
module.exports={initialize};
