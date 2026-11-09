'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const reviewedHashes=new Set([
 '580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e', // Archived Rules used by the CI fixture.
 '3d1b40acb1f4a53b43b8d8cdeabbe1a70779c59307465f0882f5e0e118500d7f', // Live Rules confirmed by the 2026-11-09 read-only check.
]);
const queueRules=readFileSync(join(__dirname,'../queue-rules.fragment'),'utf8').trimEnd();

function composeRules(source){
 if(!reviewedHashes.has(createHash('sha256').update(source).digest('hex'))){
  throw Error('Unreviewed Firestore Rules baseline');
 }
 const edits=[
  ['    function noOperationsCreate(d)',
   `${queueRules.split('\n').map(line=>'    '+line).join('\n')}\n\n`+
   `    function registrationQueueOwnsRoom(d) { return d.get('registrationQueueVersion', 0) == 2; }\n`+
   `    function registrationQueueMarkerUnchanged() {\n`+
   `      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['registrationQueueVersion']);\n`+
   `    }\n`+
   '    function noOperationsCreate(d)'],
  ["function noOperationsCreate(d) { return !d.keys().hasAny(['refereeSeatsV1',",
   "function noOperationsCreate(d) { return !d.keys().hasAny(['registrationQueueVersion','refereeSeatsV1',"],
  ["return !onsiteWaitlistOwned(t) && !('registrationSelection' in t);",
   "return !registrationQueueOwnsRoom(t) && !onsiteWaitlistOwned(t) && !('registrationSelection' in t);"],
  ["allow delete: if !('scoreStorage' in resource.data) && resource.data.get('qrCheckinManaged'",
   "allow delete: if !registrationQueueOwnsRoom(resource.data) && !('scoreStorage' in resource.data) && resource.data.get('qrCheckinManaged'"],
  ["allow update: if !('scoreStorage' in resource.data) && !('scoreStorage' in request.resource.data) && refereeSeatWriteValid(code, true)",
   "allow update: if !registrationQueueOwnsRoom(resource.data) && registrationQueueMarkerUnchanged() && !('scoreStorage' in resource.data) && !('scoreStorage' in request.resource.data) && refereeSeatWriteValid(code, true)"],
  ['allow write: if (!onsiteWaitlistOwned(get(tourPath(code)).data)',
   'allow write: if !registrationQueueOwnsRoom(tournamentDataFor(code)) && (!onsiteWaitlistOwned(get(tourPath(code)).data)'],
  ["allow delete: if (!exists(tourPath(code)) || !('scoreStorage' in get(tourPath(code)).data))",
   "allow delete: if (!exists(tourPath(code)) || (!registrationQueueOwnsRoom(tournamentDataFor(code)) && !('scoreStorage' in tournamentDataFor(code))))"],
  ["&& noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && !('scoreStorage' in tournamentDataAfterFor(code))",
   "&& noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && !registrationQueueOwnsRoom(tournamentDataAfterFor(code)) && !('scoreStorage' in tournamentDataAfterFor(code))"],
  ['allow update: if tournamentExistsFor(code) && tournamentExistsAfterFor(code) &&',
   'allow update: if tournamentExistsFor(code) && tournamentExistsAfterFor(code) && !registrationQueueOwnsRoom(tournamentDataFor(code)) && registrationQueueMarkerUnchanged() &&'],
 ];
 for(const [before,after] of edits){
  const index=source.indexOf(before);
  if(index<0||source.indexOf(before,index+before.length)!==-1)throw Error('Rules anchor changed: '+before);
  source=source.replace(before,after);
 }
 return source;
}

if(require.main===module){
 if(process.argv.length!==3)throw Error('Usage: node compose-rules.cjs <reviewed-rules>');
 process.stdout.write(composeRules(readFileSync(process.argv[2],'utf8')));
}

module.exports={composeRules};
