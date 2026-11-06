'use strict';
// Source-only adapter. The authorized caller owns the read transaction and the
// observed object, which must live outside its SDK retry callback.
const Certificate=require('../completion/certificate.cjs');
const {participantPool}=require('./identity.cjs');
async function readRaffleState(core,{db,tx,root,pub,code,observed},identityVersion='legacy'){
 if(!['legacy','participant-v1'].includes(identityVersion))throw Error('raffle-identity-version');
  if(!db?.doc||!tx?.get||!root?.exists||root.ref?.path!=='tournaments/'+code||pub?.ref?.path!=='publicTournaments/'+code||typeof code!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(code)||!observed||typeof observed!=='object')throw Error('raffle-input-context');
  const top=root.data(),publicData=pub.data();
  let state,context;
  if(Certificate.marked(top,publicData)){
   // A marker on the wrong root must not be silently ignored by materialization.
   if(Certificate.has(top,'scoreBucketProjection')||Certificate.has(publicData,'scoreStorage'))throw Error('bucket-raffle-context');
   const input=await Certificate.load({db,tx,root,pub});
   Certificate.completed(input);
   state=input.state;
   const m=input.m;
   context=['bucket',Certificate.identity(root),Certificate.identity(pub),m.schema,m.status,m.roomId,m.epoch,m.courtCount,m.bucketCount];
  }else{
   state=core.parseState(top);
   context=['legacy',Certificate.identity(root),pub.exists?Certificate.identity(pub):null];
  }
  const binding=JSON.stringify([...context,identityVersion]);
  if(Object.hasOwn(observed,'binding')&&observed.binding!==binding)throw Error('raffle-room-changed');
  observed.binding=binding;
  return state;
}
function createRaffleInput(core,{identityVersion='legacy'}={}){
 if(!core||['parseState','candidates','poolHash'].some(k=>typeof core[k]!=='function'))throw Error('raffle-core-required');
 if(!['legacy','participant-v1'].includes(identityVersion))throw Error('raffle-identity-version');
 return async function read(args){
  const {mode,excluded=[]}=args;
  if(!Array.isArray(excluded)||excluded.length>2000||excluded.some(x=>typeof x!=='string'))throw Error('raffle-exclusion-context');
  const state=await readRaffleState(core,args,identityVersion);
  const pool=identityVersion==='participant-v1'?participantPool(core,state,mode,excluded):core.candidates(state,mode,excluded);
  if(pool.length>1000)throw Error('candidate-limit-1000');
  // Keep SDK birth, epoch, vector and score state out of the existing public pool.
  return {pool,candidateHash:core.poolHash(pool)};
 };
}
module.exports={createRaffleInput,readRaffleState};
