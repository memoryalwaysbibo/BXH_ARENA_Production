'use strict';
const {createHash}=require('node:crypto');
const fs=require('node:fs');
function prepareFamilySource(source,expectedSha256){
  if(!/^[a-f0-9]{64}$/.test(expectedSha256||'')||createHash('sha256').update(source).digest('hex')!==expectedSha256)throw Error('family-source-baseline-mismatch');
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw Error('family-capacity-anchor-mismatch');
    source=source.replace(before,after);
  };
  replace('  let occupied=participants?participants.count:0;\n  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];',
`  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];
  // Finite official rooms include imported/onsite seats in the same admission
  // transaction. Counters retain their online-only meaning for cancellation.
  if(!quick&&(!Number.isSafeInteger(t.capacity)||t.capacity<1||pub.capacity!==t.capacity||!Number.isSafeInteger(confirmed)||confirmed<0))throw Error('registration-state-conflict');
  if(!quick&&(!Array.isArray(s.players)||s.players.some(p=>!p||typeof p!=='object'||Array.isArray(p))))throw Error('corrupt-state');
  const localSeats=quick?0:s.players.filter(p=>p.source!=='online'&&!p.registrationId).length;
  let occupied=participants?participants.count:Math.max(s.players.length,confirmed+localSeats);`);
  replace(':confirmed<Number(t.capacity)',':occupied<t.capacity');
  return source;
}
if(require.main===module)process.stdout.write(prepareFamilySource(fs.readFileSync(process.argv[2],'utf8'),process.argv[3]));
module.exports={prepareFamilySource};
