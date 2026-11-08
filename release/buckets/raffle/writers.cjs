'use strict';
// Unwired transaction services. No configuration/rollout or historical migration.
const {randomUUID}=require('node:crypto');
const {createContext}=require('./context.cjs');
const {readRaffleState}=require('./input.cjs');
const {participantPool,parseParticipantKey}=require('./identity.cjs');
function createRaffleWriters(options){
 const {db,core,HttpsError,now=Date.now,select=(pool,count)=>core.draw(pool,count)}=options,gates=createContext(options);
 const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new HttpsError('invalid-argument','invalid-id');return v;};
 async function state(ctx,tx,observed){return readRaffleState(core,{db,tx,root:ctx.root,pub:ctx.pub,code:ctx.code,observed},ctx.version);}
 function validateRecord(ctx,data){
  if(!Array.isArray(data.candidates)||data.candidates.length>1000||!Array.isArray(data.winners)||!data.winners.length)throw Error('raffle-record-invalid');
  const keys=new Set();
  for(const row of data.candidates){if(typeof row.key!=='string'||typeof row.playerId!=='string'||keys.has(row.key))throw Error('raffle-record-invalid');keys.add(row.key);if(ctx.version==='participant-v1'&&parseParticipantKey(row.key)[1]!==row.playerId)throw Error('raffle-record-invalid');}
  if(data.winners.length>2000||new Set(data.winners.map(w=>w.key)).size!==data.winners.length||data.winners.some(w=>!keys.has(w.key)||!['pending','claimed','forfeited','replaced'].includes(w.status)||!data.candidates.some(p=>p.key===w.key&&p.playerId===w.playerId)))throw Error('raffle-record-invalid');
  if(ctx.version==='participant-v1'&&new Set(data.candidates.map(p=>p.playerId)).size!==data.candidates.length)throw Error('raffle-record-invalid');
  if(ctx.version==='participant-v1'&&(data.candidateHash!==core.poolHash(data.candidates)||data.winners.some(w=>!ctx.prior.includes(w.key))))throw Error('raffle-record-invalid');
 }
 const draw=async request=>{
  const base=gates.requestContext(request),d=request.data,op=id(d.operationId),mode=d.mode,excludePrevious=d.excludePrevious!==false,observed={};
  let normalized;try{normalized=core.normalizePrizes(d.prizes,{title:d.title,description:d.description,count:d.count});}catch(e){gates.translate(e);}
  const {prizes,totalCount:count}=normalized,title=prizes.length===1?prizes[0].name:`多品項抽獎（${prizes.length} 項）`,description=prizes.length===1?prizes[0].description:'';
  const raffle=db.doc(`tournaments/${base.code}/raffles/${op}`),activity=db.doc(`tournamentActivity/${base.code}`),log=db.doc(`tournaments/${base.code}/operationLog/${randomUUID()}`);
  try{return await db.runTransaction(async tx=>{
   const [actor,root,pub,ledger,receipt]=await tx.getAll(base.actorRef,base.rootRef,base.pubRef,base.ledgerRef,raffle);
   // A competing duplicate may create the ledger before this SDK retry. The
   // saved room/version seal and receipt govern replay, not initial absence.
   const ctx=gates.authorize(base,{actor,root,pub,ledger},observed,{allowClosed:true,bindLedger:false});
   const current=await state(ctx,tx,observed);gates.recordContext(ctx,receipt);
   if(receipt.exists){
    const old=receipt.data(),oldPrizes=core.normalizePrizes(old.prizes,{title:old.title,description:old.description,count:old.count});
    if(old.createdBy!==base.uid||old.mode!==mode||old.excludePrevious!==excludePrevious||JSON.stringify(oldPrizes.prizes)!==JSON.stringify(prizes)||old.candidateHash!==undefined&&old.candidateHash!==d.candidateHash)throw Error('operation-conflict');
    validateRecord(ctx,old);return {ok:true,id:op,...old,replayed:true};
   }
   if(root.data().systemClosed)throw Error('system-closed');
   const pool=ctx.version==='participant-v1'?participantPool(core,current,mode,excludePrevious?ctx.prior:[]):core.candidates(current,mode,excludePrevious?ctx.prior:[]);
   if(pool.length>1000)throw Error('candidate-limit-1000');const candidateHash=core.poolHash(pool);
   if(d.candidateHash!==candidateHash)throw Error('candidate-list-changed');
   const selected=select(pool,count),winners=core.assignPrizeWinners(selected,prizes),at=now();
   if(new Set(selected.map(w=>w.key)).size!==count||selected.some(w=>!pool.some(p=>p.key===w.key&&p.playerId===w.playerId&&p.name===w.name)))throw Error('raffle-selection-invalid');
   const keys=[...new Set([...ctx.prior,...winners.map(w=>w.key)])];if(keys.length>2000)throw Error('winner-ledger-limit');
   const record={title,description,prizes,mode,count,excludePrevious,candidates:pool,winners,candidateHash,createdAt:at,createdBy:base.uid,testMode:root.data().testMode===true,revision:0,...ctx.seal};
   tx.create(raffle,record);tx.set(base.ledgerRef,{winnerKeys:keys,...ctx.seal},{merge:true});tx.set(activity,{lastAt:at},{merge:true});tx.create(log,{type:'raffle-draw',at,actor:base.uid,raffleId:op,title,count,prizeCount:prizes.length,...ctx.seal});
   return {ok:true,id:op,...record};
  });}catch(e){gates.translate(e);}
 };
 const update=async request=>{
  const base=gates.requestContext(request),d=request.data,rid=id(d.raffleId),op=id(d.operationId),reason=core.cleanText(d.reason,300),observed={};
  if(!['claim','forfeit','replace'].includes(d.action))throw new HttpsError('invalid-argument','invalid-action');
  if(d.action!=='claim'&&reason.length<2)throw new HttpsError('invalid-argument','reason-required');
  const raffle=db.doc(`tournaments/${base.code}/raffles/${rid}`),operation=db.doc(`tournaments/${base.code}/operationLog/${op}`),activity=db.doc(`tournamentActivity/${base.code}`);
  try{return await db.runTransaction(async tx=>{
   const [actor,root,pub,ledger,record,receipt]=await tx.getAll(base.actorRef,base.rootRef,base.pubRef,base.ledgerRef,raffle,operation);
   const ctx=gates.authorize(base,{actor,root,pub,ledger},observed,{allowClosed:true,bindLedger:false});
   await state(ctx,tx,observed);gates.recordContext(ctx,record);gates.recordContext(ctx,receipt);
   if(receipt.exists){const old=receipt.data();if(old.type!=='raffle-winner'||old.actor!==base.uid||old.raffleId!==rid||old.winnerKey!==d.winnerKey||old.action!==d.action||old.reason!==reason)throw Error('operation-conflict');return {ok:true,replayed:true};}
   if(root.data().systemClosed)throw Error('system-closed');if(!record.exists)throw Error('raffle-not-found');
   const data=record.data();validateRecord(ctx,data);const winners=data.winners.map(w=>({...w})),i=winners.findIndex(w=>w.key===d.winnerKey);if(i<0)throw Error('winner-not-found');
   const revision=data.revision===undefined?0:data.revision;if(!Number.isSafeInteger(revision)||revision<0)throw Error('raffle-record-invalid');const at=now();
   let nextKeys;
   if(d.action==='replace'){
    if(winners[i].status!=='forfeited')throw Error('forfeit-first');
    const pool=data.candidates.filter(p=>!ctx.prior.includes(p.key)&&!winners.some(w=>w.key===p.key)),replacement=select(pool,1)[0];
    if(!replacement||!pool.some(p=>p.key===replacement.key&&p.playerId===replacement.playerId&&p.name===replacement.name))throw Error('raffle-selection-invalid');
    nextKeys=[...new Set([...ctx.prior,replacement.key])];if(nextKeys.length>2000)throw Error('winner-ledger-limit');
    const {prizeIndex,prizeName,prizeDescription}=winners[i];winners[i].status='replaced';winners.push({...replacement,prizeIndex,prizeName,prizeDescription,status:'pending',replaces:d.winnerKey});
   }else{if(winners[i].status!=='pending')throw Error('winner-already-handled');winners[i]={...winners[i],status:d.action==='claim'?'claimed':'forfeited',handledAt:at,handledBy:base.uid,reason};}
   if(nextKeys)tx.set(base.ledgerRef,{winnerKeys:nextKeys,...ctx.seal},{merge:true});
   tx.update(raffle,{winners,revision:revision+1});tx.set(activity,{lastAt:at},{merge:true});tx.create(operation,{type:'raffle-winner',action:d.action,raffleId:rid,winnerKey:d.winnerKey,reason,at,actor:base.uid,...ctx.seal});
   return {ok:true};
  });}catch(e){gates.translate(e);}
 };
 return {draw,update};
}
module.exports={createRaffleWriters};
