'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');

// Build the candidate from the verified source capture. An updated cloud
// revision must be re-reviewed before it can be used as a release baseline.
function prepareFamilySource(source){
 const digest=createHash('sha256').update(source).digest('hex');
 if(digest!=='7a34234e26668025cda14538f030b6c4ef14daa96388a36ac01e9904c87f0b56')throw Error('family-source-baseline-mismatch');
 // Only the staged V2 copy skips #730's in-process scheduler. The durable
 // queue already coordinates execution and records completion in its own transaction.
 const patch=(before,after)=>{
  if(source.split(before).length!==2)throw Error('family-source-patch-mismatch');
  source=source.replace(before,after);
 };
 patch(`// Admission only: the existing database transaction remains authoritative across
// processes. Sharing this module-level scheduler also covers per-request factories.
const {createAdmission}=require('./registration-admission.cjs');
const admit=createAdmission();
`,'');
 patch(`};return req=>{
 const d=req.data||{},code=String(d.code||'').toUpperCase();
 if(!req.auth?.uid||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!['join','cancel','syncSummary'].includes(d.action)||!/^[a-zA-Z0-9_-]{8,100}$/.test(d.operationId||''))return handle(req);
 return admit(code,()=>handle(req),{key:JSON.stringify([req.auth.uid,d.operationId]),fingerprint:hash(JSON.stringify(d))});
};}
`,'};return handle;}\n');
 patch(
   '  let occupied=participants?participants.count:0;\n  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];',
   `  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];
  if(!quick&&(!Number.isSafeInteger(t.capacity)||t.capacity<1||pub.capacity!==t.capacity||!Number.isSafeInteger(confirmed)||confirmed<0))throw Error('registration-state-conflict');
  if(!quick&&!Array.isArray(s?.players))throw Error('corrupt-state');
  const players=s.players;
  const onsite=players.filter(p=>p&&p.source!=='online'&&!p.registrationId).length;
  let occupied=participants?participants.count:Math.max(players.length,confirmed+onsite);`
 );
 patch(':confirmed<Number(t.capacity)',':occupied<t.capacity');
 patch('module.exports={createFamilyRegistration};','createFamilyRegistration.v2CapacityAware=true;\nmodule.exports={createFamilyRegistration};');
 return source;
}

if(require.main===module)process.stdout.write(prepareFamilySource(readFileSync(process.argv[2],'utf8')));
module.exports={prepareFamilySource};
