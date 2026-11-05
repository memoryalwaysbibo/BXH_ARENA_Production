'use strict';
// This is an in-process contention limiter, not a durable/distributed queue and
// not a guarantee of request-arrival order across Cloud Run instances.
function createAdmission({maxPending=128,waitMs=45000,schedule=setTimeout,unschedule=clearTimeout}={}){
 const rooms=new Map(),flights=new Map();
 const pending=reason=>Object.assign(Error('registration-admission-pending: '+reason),{code:'registration-admission-pending',details:{reason}});
 async function enqueue(code,run){
  let room=rooms.get(code);
  if(!room){room={tail:Promise.resolve(),pending:0};rooms.set(code,room);}
  if(room.pending>=maxPending)throw pending('queue-full');
  const prior=room.tail;let release,timer;
  const gate=new Promise(resolve=>{release=resolve;});
  const tail=prior.then(()=>gate);room.tail=tail;room.pending++;
  try{
   await Promise.race([prior,new Promise((_,reject)=>{timer=schedule(()=>reject(pending('queue-timeout')),waitMs);})]);
   unschedule(timer);timer=null;
   // Start clocks and all authorization/capacity checks AFTER admission.
   return await run();
  }finally{
   if(timer!==null)unschedule(timer);
   release();room.pending--;
   // A timed-out waiter must not remove the still-running predecessor's fence.
   void tail.then(()=>{if(room.tail===tail&&room.pending===0)rooms.delete(code);});
  }
 }
 return function admit(code,run,operation){
  if(!operation)return enqueue(code,run);
  const key=JSON.stringify([code,operation.key]),previous=flights.get(key);
  if(previous){
   if(previous.fingerprint!==operation.fingerprint)return Promise.reject(Error('operation-conflict'));
   return previous.promise;
  }
  const promise=enqueue(code,run),entry={fingerprint:operation.fingerprint,promise};
  flights.set(key,entry);
  const clear=()=>{if(flights.get(key)===entry)flights.delete(key);};
  void promise.then(clear,clear);
  return promise;
 };
}
module.exports={createAdmission};
