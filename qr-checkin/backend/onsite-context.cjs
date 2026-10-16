'use strict';
const O=require('./onsite/core.cjs');
const {CheckinError}=require('./core.cjs');
function validate(aggregate){
 const x=O.inspect(aggregate);
 O.assertMutable(x.t,x.pub,x.s,{allowPendingBracket:true});
 if(x.t.onsiteWaitlistFinalized===true)O.publicState(aggregate);
 else if(x.cfg.enabled!==true)throw new CheckinError('onsite-integration-required');
 return x;
}
async function read(tx,ref,room,publicRoom,user){
 const [registrations,rounds,withdrawals,replacements]=await Promise.all([
  tx.get(ref.collection('registrations').limit(O.MAX_REGISTRATIONS+1)),
  tx.get(ref.collection('onsiteWaitlistRounds').orderBy('number')),
  tx.get(ref.collection('onsiteWaitlistWithdrawals').orderBy('revision')),
  tx.get(ref.collection('onsiteWaitlistReplacements').orderBy('revision')),
 ]);
 if(registrations.size>O.MAX_REGISTRATIONS)throw new CheckinError('transaction-size-limit');
 return {user,tournament:room,publicTournament:publicRoom,
  registrations:registrations.docs.map(s=>({...s.data(),registrationId:s.id})),
  rounds:rounds.docs.map(s=>s.data()),withdrawals:withdrawals.docs.map(s=>s.data()),replacements:replacements.docs.map(s=>s.data()),operations:{}};
}
function advanceRuntime(room,state,view){
 const revision=room.onsiteWaitlistRuntimeRevision+1;
 if(!Number.isSafeInteger(revision))throw new CheckinError('revision-exhausted');
 const patch={onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:revision};
 Object.assign(state,patch);Object.assign(view,patch);return patch;
}
module.exports={O,validate,read,advanceRuntime};
