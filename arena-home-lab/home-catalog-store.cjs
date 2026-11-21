'use strict';
const {projectPublicCard}=require('./home-publisher.cjs');
const {readCatalogPage}=require('./home-catalog-read.cjs');
const PROJECT='demo-arena-home-compare';
// Not a player-readable path. Only an in-process lab service reads this doc.
const SIGNAL_PATH='arenaHomeLab/catalogVersion';
const PATH='arenaHomeLabPrivateCatalog/current';
const MAX_GENERATION_BYTES=640*1024;
function createLabCatalogStore(db,env=process.env){
 if(env.FIRESTORE_EMULATOR_HOST!==process.env.FIRESTORE_EMULATOR_HOST||!/^127\.0\.0\.1:[1-9]\d{3,4}$/.test(env.FIRESTORE_EMULATOR_HOST??'')||env.GOOGLE_CLOUD_PROJECT!==PROJECT||db.projectId!==PROJECT)throw Error('home-catalog-demo-only');
 const ref=db.doc(PATH),signal=db.doc(SIGNAL_PATH);
 async function previousGeneration(tx){return (await tx.get(ref)).data()??null;}
 async function prepare(tx,rooms,prior){
  const previous=prior===undefined?await previousGeneration(tx):prior;
  const cards=rooms.map(r=>projectPublicCard(r)).filter(Boolean).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(cards.length>250||new Set(cards.map(c=>c.id)).size!==cards.length)throw Error('home-catalog-source');
  if(previous!==null&&JSON.stringify(previous.cards)===JSON.stringify(cards))return {version:previous.version,changed:false};
  const version=previous===null?(cards.length===0?0:1):previous.version+1;
  if(!Number.isSafeInteger(version)||version<0)throw Error('home-catalog-version');
  const generation={version,cards};
  if(Buffer.byteLength(JSON.stringify(generation))>MAX_GENERATION_BYTES)throw Error('home-catalog-size');
  return {version,changed:true,generation};
 }
 function stage(tx,result){
  if(!result.changed)return;
  tx.set(ref,result.generation);
  tx.set(signal,{version:result.version});
 }
 function watchCatalogVersion(next,error){
  if(typeof next!=='function'||typeof error!=='function')throw Error('catalog-listener');
  return signal.onSnapshot(snapshot=>{
   const version=snapshot.data()?.version;
   if(Number.isSafeInteger(version)&&version>=0)next({version,fromCache:false,hasPendingWrites:false});
  },error);
 }
 async function readCatalog({version,category,filters,cursor,limit}={}){
  if(version!==undefined&&(!Number.isSafeInteger(version)||version<0))throw Error('catalog-request');
  // One document snapshot: an update during a request cannot mix generations.
  const current=(await ref.get()).data();
  if(!current)throw Error('catalog-unavailable');
  if(version!==undefined&&version!==current.version)return {kind:'restart',version:current.version};
  return readCatalogPage(current,{category,filters,cursor,limit});
 }
 return {prepare,stage,previousGeneration,readCatalog,watchCatalogVersion};
}
module.exports={createLabCatalogStore,SIGNAL_PATH};
