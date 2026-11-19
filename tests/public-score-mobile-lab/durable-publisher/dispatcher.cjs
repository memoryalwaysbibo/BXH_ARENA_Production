'use strict';
// Lab-only bounded polling dispatcher, no cloud trigger registration.
async function dispatchOnce(db,publisher,room){
 if(!/^BXH-DEMO[A-Z0-9]*$/.test(room))throw Error('demo-room-required');
 const state=await db.doc('tournaments/'+room).get();
 const revision=state.data()?.stagingPublicationRevision;
 if(!revision)return {idle:true};
 // Highest durable marker is sufficient: worker projects latest authoritative room.
 // Failure propagates for backoff/reporting; cursor remains behind so next poll retries.
 return publisher.publish(revision);
}
module.exports={dispatchOnce};
