'use strict';
// Isolated server prototype. No SDK initialization, triggers, credentials or network calls.
const S=require('../../../referee-seats/functions/scoring-core.cjs');
const schema=require('../public-schema.cjs'),B=require('../bridge.cjs');
function scope(config){
 if(config?.mode!=='offline-test'||config.projectId!=='demo-bxh-arena-e2e'||!/^BXH-DEMO[A-Z0-9]*$/.test(config.room)||!/^demo-[a-z0-9-]+$/.test(config.epoch))throw Error('isolated-target-required');
 return config;
}
function createPublisher(db,config,{validate=schema.validate}={}){
 const c=scope(config),root='stagingScoreOutbox/'+c.room+'/events/',cursor=db.doc('stagingScorePublisher/'+c.room),pub='labRooms/'+c.room;
 const key=n=>String(n).padStart(12,'0');
 function enqueue(tx,room,state,code){
  if(code!==c.room||room.visibility!=='public'||room.stagingPublicationDisabled===true)return;
  const revision=(room.stagingPublicationRevision||0)+1;
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('invalid-revision');
  // Minimal durable wake marker. No projection/schema work can abort scoring.
  const event={schema:2,epoch:c.epoch,revision};
  tx.create(db.doc(root+key(revision)),event);
  tx.update(db.doc('tournaments/'+code),{stagingPublicationRevision:revision});
 }
 async function publish(revision){
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('invalid-revision');
  const requestedRevision=revision;
  return db.runTransaction(async tx=>{
   let revision=requestedRevision;
   const [eventSnap,priorSnap,roomSnap]=await Promise.all([tx.get(db.doc(root+key(revision))),tx.get(cursor),tx.get(db.doc('tournaments/'+c.room))]);
   if(!eventSnap.exists)throw Error('missing-outbox-event');
   if(!roomSnap.exists||roomSnap.data().visibility!=='public'||roomSnap.data().stagingPublicationDisabled===true)throw Error('room-not-eligible');
   const event=eventSnap.data(),prior=priorSnap.data();
   if(event.schema!==2||event.epoch!==c.epoch||event.revision!==revision||revision>roomSnap.data().stagingPublicationRevision)throw Error('invalid-event');
   if(prior&&prior.epoch!==c.epoch)throw Error('epoch-reset-required');
   if(prior&&revision<=prior.revision)return {duplicate:true,revision:prior.revision};
   // Read latest authoritative state in the SAME worker transaction; coalesce old wakes.
   revision=roomSnap.data().stagingPublicationRevision;
   const state=JSON.parse(roomSnap.data().data);
   const view=validate(S.publicProjection(state,{meta:{stations:state.meta.stations},players:state.players}));
   if(Buffer.byteLength(JSON.stringify(view))>800000)throw Error('publication-too-large');
   const hash=B.digest(view);
   // Never make a delta across missing revisions. A complete authoritative checkpoint can skip a gap safely.
   const packet=prior&&revision===prior.revision+1?B.delta(prior.view,view,c.epoch,prior.revision):B.checkpoint(view,c.epoch,revision);
   tx.set(db.doc(pub+'/public/checkpoint'),{packet:JSON.stringify(B.checkpoint(view,c.epoch,revision))});
   tx.set(db.doc(pub+'/deltas/'+key(revision)),{revision,packet:JSON.stringify(packet)});
   tx.set(cursor,{epoch:c.epoch,revision,hash,view});
   return {revision,type:packet.type};
  });
 }
 return {enqueue,publish};
}
module.exports={createPublisher,scope};
