'use strict';
/** Read-only change impact preview; never mutates player records. */
const {evaluateWithActiveRelease}=require('./assembly-rule-registry.cjs');
function key(parts){return [...new Set(parts||[])].sort().join('|');}
function impactPreview({state,candidateRelease,configurations}={}){
 if(!state||!Array.isArray(state.releases)||!candidateRelease||!Array.isArray(configurations))throw Error('INVALID_IMPACT_INPUT');
 const previous=state.releases.find(x=>x.releaseId===state.activeReleaseId);
 if(!previous)throw Error('NO_ACTIVE_RELEASE');
 const ids=new Set(configurations.map(x=>x.configId));
 if(ids.size!==configurations.length||configurations.some(x=>!x.configId||!Array.isArray(x.parts)||!x.template))throw Error('INVALID_CONFIGURATIONS');
 const nextState={...state,activeReleaseId:candidateRelease.releaseId,releases:[...state.releases.filter(x=>x.releaseId!==candidateRelease.releaseId),candidateRelease]};
 const affected=[];
 for(const item of configurations){
  const before=evaluateWithActiveRelease({state,parts:item.parts,template:item.template});
  const after=evaluateWithActiveRelease({state:nextState,parts:item.parts,template:item.template});
  if(before.status!==after.status||before.reason!==after.reason)
   affected.push({configId:item.configId,partKey:key(item.parts.map(x=>x.partId)),before:before.status,after:after.status,beforeReason:before.reason,afterReason:after.reason});
 }
 return Object.freeze({fromRelease:previous.releaseId,toRelease:candidateRelease.releaseId,checked:configurations.length,changed:affected.length,affected,playerRecordsMutated:0,officialResultsMutated:0,requiresApproval:true});
}
module.exports={impactPreview};
