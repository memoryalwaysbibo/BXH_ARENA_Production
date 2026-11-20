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
 patch(
  '  const quick=quickPolicy(t,pub);let mirror;\n  if(quick){',
  `  const quick=quickPolicy(t,pub);
  const anyTicket=t.eventAuthority==='ticket'||pub.eventAuthority==='ticket'||!!t.ticketAccessV1||!!pub.ticketRoomVersion;
  const ticket=t.eventAuthority==='ticket'&&pub.eventAuthority==='ticket'&&t.ticketAccessV1?.version===1&&
   t.ticketAccessV1.roomId===s.id&&pub.ticketRoomVersion===1&&t.registrationQueueVersion===2&&pub.registrationQueueVersion===2&&
   [32,64,96,128,160].includes(t.capacity)&&t.capacity===pub.capacity&&t.capacity===s.meta?.registrationCapacity&&
   t.ticketAccessV1.baseCapacity===t.capacity&&t.ticketAccessV1.addedCapacity===0&&!t.waitlistEnabled&&!pub.waitlistEnabled;
  if(anyTicket&&!ticket)throw Error('registration-state-conflict');
  const projectOnline=!!quick||ticket;
  let mirror;
  if(projectOnline){`
 );
 patch('  const quickRows=quick?', '  const quickRows=projectOnline?');
 patch('  if(quick){\n   if(pub.systemClosed', '  if(projectOnline){\n   if(pub.systemClosed');
 patch("   const id=String(d.registrationId||uid);", "   const ticketHostRemoval=ticket&&d.intent==='ticket-host';\n   const id=String(d.registrationId||uid);");
 patch("if(!reg||(id!==uid&&reg.guardianUid!==uid))", "if(!reg||(!ticketHostRemoval&&id!==uid&&reg.guardianUid!==uid))");
 patch("if(quick ? (quick.cancellationDeadline", "if(!ticketHostRemoval&&(quick ? (quick.cancellationDeadline");
 patch("now>=ms(t.cancellationDeadline)))throw", "now>=ms(t.cancellationDeadline))))throw");
 patch("const result={ok:true};if(reg.status!=='cancelled')", "const result=ticket?{ok:true,status:'cancelled',registrationId:id}:{ok:true};if(reg.status!=='cancelled')");
 patch("const proofFields=myEventsProofEnabled===true?operationFields(uid,code,'cancel'", "const proofFields=myEventsProofEnabled===true&&!ticketHostRemoval?operationFields(uid,code,'cancel'");
 patch("(quick?project(quickRows.map","(projectOnline?project(quickRows.map");
 patch("  if(quick){\n   const next=new Map(quickRows","  if(projectOnline){\n   const next=new Map(quickRows");
 patch("const fields={communityParticipantCount:result.communityParticipantCount,","const fields={...(!ticket?{communityParticipantCount:result.communityParticipantCount}:{}),");
 patch('module.exports={createFamilyRegistration};','createFamilyRegistration.v2CapacityAware=true;\nmodule.exports={createFamilyRegistration};');
 patch("if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');",
       "if(!/^(?:BXH-[A-Z0-9]{4,16}|PTN-[A-Z0-9]{6})$/.test(code))throw Error('invalid-code');");
 return source;
}

function prepareFamilyProofSource(source){
 const digest=createHash('sha256').update(source).digest('hex');
 if(digest!=='e33b8d08f8653a546a7656fd529478f4938b258046a88a4fae3e4b337017d5a9')throw Error('family-proof-baseline-mismatch');
 return source.replace('/^BXH-[A-Z0-9]{4,16}$/','/^(?:BXH-[A-Z0-9]{4,16}|PTN-[A-Z0-9]{6})$/');
}
if(require.main===module){
 const prepare=process.argv[3]==='--proof'?prepareFamilyProofSource:prepareFamilySource;
 process.stdout.write(prepare(readFileSync(process.argv[2],'utf8')));
}
module.exports={prepareFamilySource,prepareFamilyProofSource};
