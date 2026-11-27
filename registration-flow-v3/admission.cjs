'use strict';

// Process-local admission only reduces contention. The Firestore transaction
// and persistent receipt remain authoritative across processes and restarts.
function createAdmission({maxPending=512}={}){
 const rooms=new Map();
 return function admit(code,work){
  const state=rooms.get(code)||{tail:Promise.resolve(),count:0};
  if(state.count>=maxPending)return Promise.reject(Error('registration-busy'));
  state.count++;rooms.set(code,state);
  const current=state.tail.then(work);
  state.tail=current.catch(()=>{});
  return current.finally(()=>{
   state.count--;
   if(!state.count&&rooms.get(code)===state)rooms.delete(code);
  });
 };
}
const sharedAdmission=createAdmission();
module.exports={createAdmission,sharedAdmission};
