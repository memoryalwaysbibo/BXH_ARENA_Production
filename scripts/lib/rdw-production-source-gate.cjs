'use strict';
// RDW P2-8 read-only provenance gate; never connects to Firebase or changes production state.
function assess(parity,service='courtCallService'){
 if(!parity||!Array.isArray(parity.services))throw Error('parity-inventory-invalid');
 const item=parity.services.find(s=>s.name===service);
 if(!item)return {service,status:'blocked',reason:'service-not-in-inventory'};
 const matches=Array.isArray(item.verifiedSourceMatches)?item.verifiedSourceMatches:[];
 if(!matches.length)return {service,status:'blocked',reason:'deployed-source-not-verified',sourceGeneration:item.sourceGeneration||null,recordedAt:parity.recordedAt||null};
 return {service,status:'reference-match-present',reason:'requires-current-runtime-reverification',sourceGeneration:item.sourceGeneration||null,recordedAt:parity.recordedAt||null,matchCount:matches.length};
}
module.exports={assess};
