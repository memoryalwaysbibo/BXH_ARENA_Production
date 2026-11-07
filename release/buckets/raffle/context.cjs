'use strict';
const Certificate=require('../completion/certificate.cjs');
const {parseParticipantKey}=require('./identity.cjs');
const own=Certificate.has;
function childRoom(parent,child){
 if(!child.exists)return;
 const d=child.data();
 if(own(d,'sourceCreatedAt')){if(d.sourceCreatedAt!==Certificate.identity(parent))throw Error('room-generation-changed');}
 else if(child.createTime.seconds<parent.createTime.seconds||child.createTime.seconds===parent.createTime.seconds&&child.createTime.nanoseconds<parent.createTime.nanoseconds)throw Error('room-generation-changed');
}
function createContext({db,core,HttpsError,now=Date.now,newIdentityVersion='participant-v1'}){
 if(!db?.runTransaction||typeof core?.canManage!=='function'||typeof HttpsError!=='function'||!['legacy','participant-v1'].includes(newIdentityVersion))throw Error('raffle-preview-dependencies');
 function requestContext(request){
  const uid=request?.auth?.uid;
  if(typeof uid!=='string'||!uid||uid.includes('/'))throw new HttpsError('unauthenticated','auth-required');
  const raw=request?.data?.code;
  if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(raw))throw new HttpsError('invalid-argument','invalid-id');
  const code=raw.toUpperCase();
  return {uid,code,actorRef:db.doc('users/'+uid),rootRef:db.doc('tournaments/'+code),pubRef:db.doc('publicTournaments/'+code),ledgerRef:db.doc('tournaments/'+code+'/raffleControl/current')};
 }
 function authorize(base,{actor,root,pub,ledger},observed,{allowClosed=false,bindLedger=true}={}){
  if(!actor.exists||actor.data().active!==true)throw new HttpsError('permission-denied','inactive-account');
  if(!root.exists)throw new HttpsError('not-found','tournament-not-found');
  if(!core.canManage(actor.data(),base.uid,root.data(),now()))throw new HttpsError('permission-denied','tournament-access-denied');
  if(!allowClosed&&root.data().systemClosed)throw Error('system-closed');
  const seal={sourceCreatedAt:Certificate.identity(root),sourcePublicCreatedAt:pub.exists?Certificate.identity(pub):null,sourceBucketEpoch:root.data().scoreStorage?.epoch||null},data=ledger.data()||{};
  childRoom(root,ledger);
  for(const field of ['sourcePublicCreatedAt','sourceBucketEpoch'])if(own(data,field)&&data[field]!==seal[field])throw Error('room-generation-changed');
  const ledgerIdentity=ledger.exists?Certificate.identity(ledger):null;
  if(bindLedger&&own(observed,'ledgerIdentity')&&observed.ledgerIdentity!==ledgerIdentity)throw Error('raffle-ledger-changed');
  if(bindLedger)observed.ledgerIdentity=ledgerIdentity;
  const version=ledger.exists?(own(data,'identityVersion')?data.identityVersion:'legacy'):newIdentityVersion;
  if(!['legacy','participant-v1'].includes(version))throw Error('raffle-identity-version');
  const prior=data.winnerKeys===undefined?[]:data.winnerKeys;
  if(!Array.isArray(prior)||prior.length>2000||prior.some(key=>typeof key!=='string'))throw Error('raffle-exclusion-context');
  if(version==='participant-v1')prior.forEach(parseParticipantKey);
  if(ledger.exists&&version==='participant-v1'&&Object.keys(seal).some(field=>!own(data,field)||data[field]!==seal[field]))throw Error('raffle-receipt-context');
  return {...base,actor,root,pub,ledger,version,prior,seal:{...seal,identityVersion:version}};
 }
 function recordContext(ctx,snapshot){
  childRoom(ctx.root,snapshot);
  if(!snapshot.exists)return;
  const data=snapshot.data(),version=own(data,'identityVersion')?data.identityVersion:'legacy';
  if(version!==ctx.version)throw Error('raffle-identity-version-changed');
  for(const field of ['sourcePublicCreatedAt','sourceBucketEpoch'])if(own(data,field)&&data[field]!==ctx.seal[field])throw Error('room-generation-changed');
  if(version==='participant-v1'&&Object.keys(ctx.seal).some(field=>!own(data,field)||data[field]!==ctx.seal[field]))throw Error('raffle-receipt-context');
 }
 const translate=e=>{if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',String(e.message||'operation-failed'));};
 return {requestContext,authorize,recordContext,translate};
}
module.exports={createContext};
