'use strict';
const {CAP,CONTROL}=require('./team-capacity.cjs');
// Server-only initialization for a controlled maintenance window. Team mutations
// must remain disabled and unrelated privileged writers must not change teams.
// Existing counters are checked, never silently overwritten or repaired.
function createCapacityBootstrap({db,clock=Date.now}){
 if(!db?.doc||!db?.collection||!db?.runTransaction)throw Error('database-required');
 return async function initialize(){
  return db.runTransaction(async tx=>{
   const ref=db.doc(CONTROL),query=db.collection('teamsV1').where('status','==','active').limit(CAP+1);
   const [control,teams]=await Promise.all([tx.get(ref),tx.get(query)]),count=teams.docs.length;
   if(count>CAP)throw Error('team-capacity-exceeded');
   if(control.exists){const existing=control.data()?.activeCount;if(!Number.isSafeInteger(existing)||existing<0||existing>CAP)throw Error('team-capacity-unavailable');if(existing!==count)throw Error('team-capacity-mismatch');return {status:'verified',activeCount:count};}
   const now=clock();if(!Number.isSafeInteger(now)||now<0)throw Error('invalid-clock');
   tx.create(ref,{activeCount:count,initializedAt:now});return {status:'initialized',activeCount:count};
  });
 };
}
module.exports={createCapacityBootstrap};
