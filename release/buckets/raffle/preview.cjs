'use strict';
// Source-only callable service; wiring/release of all raffle paths is separate.
const {createContext}=require('./context.cjs');
const {createRaffleInput}=require('./input.cjs');
function createRafflePreview(options){
 const {db,core}=options,gates=createContext(options);
 const readers={legacy:createRaffleInput(core),['participant-v1']:createRaffleInput(core,{identityVersion:'participant-v1'})};
 return async request=>{
  const base=gates.requestContext(request),observed={};
  try{return await db.runTransaction(async tx=>{
   const [actor,root,pub,ledger]=await tx.getAll(base.actorRef,base.rootRef,base.pubRef,base.ledgerRef);
   const ctx=gates.authorize(base,{actor,root,pub,ledger},observed);
   const result=await readers[ctx.version]({db,tx,root,pub,code:base.code,mode:request.data.mode,excluded:request.data.excludePrevious!==false?ctx.prior:[],observed});
   return {ok:true,count:result.pool.length,candidates:result.pool,candidateHash:result.candidateHash};
  });}catch(e){gates.translate(e);}
 };
}
module.exports={createRafflePreview};
