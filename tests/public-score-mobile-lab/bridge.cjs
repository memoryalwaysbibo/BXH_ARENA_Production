'use strict';
// TEST ONLY. Input must be an already-public bracketView, never a private room.
// This transport is NOT a privacy sanitizer. Preserve existing public semantics.
const {createHash}=require('node:crypto');
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const CONTROL=new Set(['courtAssignments','forcedCourtExits','callRevision','courtLifecycleEpoch','championId','runnerUpId','thirdId','fourthId','gfMatchId','gfResetMatchId','bronzeMatchId','rrRounds','updatedAt']);
function validate(view){
 if(!view||!Array.isArray(view.matches))throw Error('invalid-public-view');
 const ids=view.matches.map(m=>m?.id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('invalid-match-ids');
}
function checkpoint(view,epoch,revision){
 validate(view);
 if(typeof epoch!=='string'||!epoch||!Number.isSafeInteger(revision)||revision<0)throw Error('invalid-version');
 return {schema:1,type:'checkpoint',epoch,revision,hash:digest(view),view:clone(view)};
}
function delta(previous,next,epoch,baseRevision){
 const check=checkpoint(next,epoch,baseRevision+1);validate(previous);
 // Structural roster/meta/order/removal changes use a checkpoint, not a lossy patch.
 if(canonical(previous.matches.map(m=>m.id))!==canonical(next.matches.map(m=>m.id)))return check;
 const set={};
 for(const key of new Set([...Object.keys(previous),...Object.keys(next)])){
  if(key==='matches'||canonical(previous[key])===canonical(next[key]))continue;
  if(!CONTROL.has(key)||!Object.hasOwn(next,key))return check;
  set[key]=clone(next[key]);
 }
 const old=new Map(previous.matches.map(m=>[m.id,m]));
 const matches=next.matches.filter(m=>canonical(m)!==canonical(old.get(m.id))).map(clone);
 return {schema:1,type:'delta',epoch,baseRevision,revision:baseRevision+1,baseHash:digest(previous),hash:check.hash,matches,set};
}
function receiver(){
 let current=null;
 return {snapshot:()=>current?clone(current):null,
 apply(packet){
  try{
   if(packet?.schema!==1||typeof packet.epoch!=='string'||!packet.epoch||!Number.isSafeInteger(packet.revision)||packet.revision<0)throw Error();
   if(current&&packet.epoch===current.epoch&&packet.revision===current.revision&&packet.hash===current.hash)return {ok:true,duplicate:true};
   let view;
   if(packet.type==='checkpoint'){
    if(current&&packet.epoch===current.epoch&&packet.revision<current.revision)throw Error();
    // Caller must pin expected epoch; new epochs are accepted only through explicit reset.
    if(current&&packet.epoch!==current.epoch)throw Error();
    view=clone(packet.view);
   }else{
    if(packet.type!=='delta'||!current||packet.epoch!==current.epoch||packet.baseRevision!==current.revision||packet.revision!==current.revision+1||packet.baseHash!==current.hash)throw Error();
    if(Object.keys(packet.set).some(k=>!CONTROL.has(k)))throw Error();
    const changed=new Map(packet.matches.map(m=>[m.id,m]));
    if(changed.size!==packet.matches.length||[...changed.keys()].some(id=>!current.view.matches.some(m=>m.id===id)))throw Error();
    view=clone(current.view);view.matches=view.matches.map(m=>clone(changed.get(m.id)||m));
    Object.assign(view,clone(packet.set));
   }
   validate(view);if(digest(view)!==packet.hash)throw Error();
   current={epoch:packet.epoch,revision:packet.revision,hash:packet.hash,view};return {ok:true};
  }catch{return {ok:false,needsCheckpoint:true};}
 }, reset(){current=null;}};
}
module.exports={checkpoint,delta,receiver,digest};
