'use strict';
const {createHash}=require('node:crypto'),B=require('./bucket-state.cjs'),S=require('./scoring-core.cjs');
const MAX_BUCKETS=100,MAX_DOCUMENT_BYTES=750000,MAX_TOTAL_BYTES=5000000;
function canonical(value){if(value&&typeof value.toJSON==='function')return canonical(value.toJSON());if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function budget(documents){const sizes=documents.map(d=>Buffer.byteLength(JSON.stringify(canonical(d))));if(sizes.some(n=>n>MAX_DOCUMENT_BYTES)||sizes.reduce((a,b)=>a+b,0)>MAX_TOTAL_BYTES)throw Error('migration-size-budget');return sizes.reduce((a,b)=>a+b,0);}
function prepare({action,code,epoch,room,publicDocument,buckets,versions}){
 if(!['activate','rollback'].includes(action)||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{1,100}$/.test(epoch))throw Error('invalid-migration-request');
 let base,previous;try{base=JSON.parse(room.data);previous=JSON.parse(publicDocument.bracketView);}catch{throw Error('corrupt-data');}
 if(!base||base.cloudCode!==code||typeof base.id!=='string'||!base.id||!Array.isArray(base.matches)||!Array.isArray(base.players)||!Number.isSafeInteger(base.meta?.stations)||base.meta.stations<1)throw Error('invalid-migration-room');
 if(!Number.isSafeInteger(room.updatedAt)||room.updatedAt<0||!Number.isSafeInteger(publicDocument.updatedAt)||publicDocument.updatedAt<0)throw Error('invalid-migration-version');
 if(base.matches.some(m=>typeof m.id!=='string'||!m.id)||new Set(base.matches.map(m=>m.id)).size!==base.matches.length)throw Error('invalid-match-identity');
 const count=Math.ceil(base.meta.stations/4);if(count>MAX_BUCKETS||buckets.length>MAX_BUCKETS)throw Error('migration-size-budget');
 let manifest,state,encoded;
 if(action==='activate'){
  if(Object.hasOwn(room,'scoreStorage')||Object.hasOwn(base,'scoreStorage'))throw Error('already-bucketed');
  if(Object.hasOwn(room,'bucketMigration'))throw Error('migration-metadata-exists');
  if(room.eventAuthority!=='official'||base.meta.eventAuthority!=='official'||room.createdByRole==='partner_organizer'||base.meta.formatType!=='single'||!['standard',undefined].includes(base.meta.scoringMode)||!['individual',undefined].includes(base.meta.battleMode)||!['standard',undefined].includes(base.meta.playMode)||room.refereeSeatsV1?.version!==1)throw Error('unsupported-migration-room');
  if(room.eventCancelled||room.systemClosed||room.deletionStatus||['completed','archived'].includes(room.archiveStatus)||['completed','archived'].includes(base.archiveStatus))throw Error('room-read-only');
  if(buckets.length)throw Error('orphan-bucket-set');
  manifest=B.makeManifest(base,epoch);encoded=B.encode(base,manifest);state=B.materialize(base,manifest,encoded);
 }else{
  manifest=B.context(room,base);if(manifest.code!==code||manifest.epoch!==epoch)throw Error('epoch-mismatch');
  if(buckets.some(b=>b.id!==b.data?.bucketId))throw Error('bucket-context');
  encoded=buckets.map(b=>b.data);state=B.materialize(base,manifest,encoded);
 }
 const publicState=S.publicProjection(state,previous),bytes=budget([room,publicDocument,state,publicState,...encoded]);
 const sourceDigest=digest({action,code,epoch,room,publicDocument,buckets:[...buckets].sort((a,b)=>a.id.localeCompare(b.id)),versions});
 return {plan:{version:1,action,code,epoch,roomId:state.id,courts:manifest.courtCount,buckets:manifest.bucketCount,versions,sourceDigest,bytes},state,manifest,encoded,previous};
}
module.exports={prepare,digest,budget,MAX_BUCKETS};
