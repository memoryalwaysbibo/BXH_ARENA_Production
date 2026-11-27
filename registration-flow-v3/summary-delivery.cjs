'use strict';

// A Firestore update event is the durable wake-up, not the in-memory batch.
// A failed invocation rejects all waiting events so the platform can retry.
// An event arriving after the sync starts requests another pass.
function createSummaryDelivery({sync,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),windowMs=250}){
 const rooms=new Map();
 return function deliver(code){
  if(typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code))return Promise.reject(Error('invalid-code'));
  const current=rooms.get(code);
  if(current){current.dirty=true;return current.promise;}
  const state={dirty:true,promise:null};
  state.promise=(async()=>{
   try{
    let result;
    do{
     await delay(windowMs);
     state.dirty=false;
     result=await sync(code);
    }while(state.dirty);
    return result;
   }finally{if(rooms.get(code)===state)rooms.delete(code);}
  })();
  rooms.set(code,state);
  return state.promise;
 };
}
module.exports={createSummaryDelivery};
