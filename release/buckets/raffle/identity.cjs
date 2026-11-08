'use strict';
// Server-selected identity scheme for a NEW raffle generation only. Names are
// labels. Never reinterpret a legacy uid-only winner key as a new participant.
const prefix='participant:v1:';
function participantKey(p){
 if(!p||typeof p.id!=='string'||!p.id||p.id.length>512)throw Error('raffle-player-id-required');
 const uid=p.registrationUid||p.uid||null;
 if(uid!==null&&(typeof uid!=='string'||uid.length>128))throw Error('raffle-account-identity-invalid');
 return prefix+JSON.stringify([uid,p.id]);
}
function parseKey(key){
 if(typeof key!=='string'||!key.startsWith(prefix))throw Error('raffle-exclusion-identity-version');
 let parts;try{parts=JSON.parse(key.slice(prefix.length));}catch{throw Error('raffle-exclusion-identity-version');}
 if(!Array.isArray(parts)||parts.length!==2||participantKey({registrationUid:parts[0],id:parts[1]})!==key)throw Error('raffle-exclusion-identity-version');
 return parts;
}
function participantPool(core,state,mode,excluded=[]){
 if(!Array.isArray(excluded)||excluded.length>2000)throw Error('raffle-exclusion-context');
 const byId=new Map(),knownKeys=new Set();
 const project=p=>{
  const key=participantKey(p);
  if(byId.has(p.id)&&byId.get(p.id)!==key)throw Error('raffle-player-id-conflict');
  byId.set(p.id,key);knownKeys.add(key);
  // Retain captured eligibility, first-round and source-precedence rules while
  // preventing its uid-only Map from collapsing distinct family participants.
  return {...p,registrationUid:key};
 };
 const projected={...state,players:state.players.map(project)};
 if(Array.isArray(state.entryCandidates))projected.entryCandidates=state.entryCandidates.map(project);
 const blocked=new Set();
 for(const key of excluded){
  const [,id]=parseKey(key);
  if(byId.has(id)&&byId.get(id)!==key)throw Error('raffle-participant-identity-changed');
  blocked.add(key);
 }
 return core.candidates(projected,mode,[]).map(row=>{
  const key=row.key.slice(4);
  if(!row.key.startsWith('uid:')||!knownKeys.has(key)||byId.get(row.playerId)!==key)throw Error('raffle-core-identity-mismatch');
  return {...row,key};
 }).filter(row=>!blocked.has(row.key)).sort((a,b)=>a.key.localeCompare(b.key));
}
module.exports={participantKey,participantPool,parseParticipantKey:parseKey};
