'use strict';
// RDW event-type policy: only ranked tournaments opt into RDW.
// READ ONLY. Unknown mode fails closed; general mode retains the legacy
// tournament start/scoring flow, with NO RDW snapshot or PASS.
function classifyRdwEvent({room}={}){
 if(!room||typeof room!=='object')return {ok:false,reason:'room-required'};
 let state=room.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'invalid-room-json'};}}
 if(!state||typeof state!=='object'||Array.isArray(state))return {ok:false,reason:'invalid-room-state'};
 const mode=state.meta?.ladderMode;
 if(mode==='ranked')return {ok:true,rdwApplicable:true,mode:'ranked'};
 if(mode==='general')return {ok:true,rdwApplicable:false,mode:'general'};
 return {ok:false,reason:'ladder-mode-unverified'};
}
module.exports={classifyRdwEvent};
