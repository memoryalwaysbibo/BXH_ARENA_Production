'use strict';
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const baselineHash='23f7acd2e06c428f3a628d1dad02d703b746cd28d1f48e6caf8c606248982e68';
function compose(source){
 if(createHash('sha256').update(source).digest('hex')!==baselineHash)throw Error('Unreviewed Firestore Rules baseline');
 const replace=(before,after)=>{
  if(source.split(before).length!==2)throw Error('Rules anchor changed: '+before);
  source=source.replace(before,after);
 };
 replace("    function noOperationsCreate(d) { return !d.keys().hasAny(['registrationQueueVersion',",
  "    function noOperationsCreate(d) { return !d.keys().hasAny(['registrationFlowVersion','registrationSummaryRevision','registrationFormalRevision','pendingReviewCount','occupiedCount','availableCount','registrationQueueVersion',");
 replace("return !changed.hasAny(['registrationQueueVersion','refereeSeatsV1','refereeSeatNames','bucketMigration']) && room.get('registrationQueueVersion', 0) != 2",
  "return !changed.hasAny(['registrationFlowVersion','registrationSummaryRevision','registrationFormalRevision','registrationQueueVersion','refereeSeatsV1','refereeSeatNames','bucketMigration']) && room.get('registrationQueueVersion', 0) != 2\n        && (room.get('registrationFlowVersion', 0) != 3 || !changed.hasAny(['capacity','confirmedCount','waitlistCount','pendingReviewCount','occupiedCount','availableCount','registrationEnabled','registrationOpenAt','registrationCloseAt','cancellationDeadline','registrationStatus','registrationVisibility','publishedAt','visibility','waitlistEnabled','waitlistCapacity']))");
 replace("return !registrationQueueOwnsRoom(t) && !onsiteWaitlistOwned(t) && !('registrationSelection' in t);",
  "return t.get('registrationFlowVersion', 0) != 3 && !registrationQueueOwnsRoom(t) && !onsiteWaitlistOwned(t) && !('registrationSelection' in t);");
 replace("    match /tournaments/{code} {",
  "    match /tournaments/{code} {\n      match /registrationV3Holds/{id} { allow read, write: if false; }\n      match /registrationV3State/{id} { allow read, write: if false; }\n      match /registrationV3Operations/{id} { allow read, write: if false; }");
 replace("    match /tournamentActivity/{code} { allow read, write: if false; }",
  "    match /registrationV3RoomCreateOperations/{id} { allow read, write: if false; }\n    match /tournamentActivity/{code} { allow read, write: if false; }");
 return source;
}
if(require.main===module){
 if(process.argv.length!==3)throw Error('Usage: node compose-rules.cjs <reviewed-live-rules>');
 process.stdout.write(compose(readFileSync(process.argv[2],'utf8')));
}
module.exports={compose,baselineHash};
