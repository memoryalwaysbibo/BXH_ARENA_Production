'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');

// Build the candidate from the verified source capture. An updated cloud
// revision must be re-reviewed before it can be used as a release baseline.
function prepareFamilySource(source){
 const digest=createHash('sha256').update(source).digest('hex');
 if(digest!=='d988ad76a0d02e82546d316a240449dc925e3c1dafd82a298345f1f5d3519145')throw Error('family-source-baseline-mismatch');
 return source
  .replace(
   '  let occupied=participants?participants.count:0;\n  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];',
   `  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];
  if(!quick&&(!Number.isSafeInteger(t.capacity)||t.capacity<1||pub.capacity!==t.capacity||!Number.isSafeInteger(confirmed)||confirmed<0))throw Error('registration-state-conflict');
  if(!quick&&!Array.isArray(s?.players))throw Error('corrupt-state');
  const players=s.players;
  const onsite=players.filter(p=>p&&p.source!=='online'&&!p.registrationId).length;
  let occupied=participants?participants.count:Math.max(players.length,confirmed+onsite);`
  )
  .replace(':confirmed<Number(t.capacity)',':occupied<t.capacity')
  .replace('module.exports={createFamilyRegistration};','createFamilyRegistration.v2CapacityAware=true;\nmodule.exports={createFamilyRegistration};');
}

if(require.main===module)process.stdout.write(prepareFamilySource(readFileSync(process.argv[2],'utf8')));
module.exports={prepareFamilySource};
