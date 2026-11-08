'use strict';

const {createHash}=require('node:crypto');

const baselineHash='d988ad76a0d02e82546d316a240449dc925e3c1dafd82a298345f1f5d3519145';

function replaceOnce(source, before, after){
  const index=source.indexOf(before);
  if(index<0||source.indexOf(before,index+before.length)>=0)throw Error('unexpected-family-roster-source');
  return source.slice(0,index)+after+source.slice(index+before.length);
}

// Apply only to the captured familyRegistration handler. A different live
// handler needs a fresh source comparison before this candidate can be used.
function addFamilyRosterReceipt(source){
  if(createHash('sha256').update(source).digest('hex')!==baselineHash)throw Error('family-roster-source-not-reviewed');
  source=replaceOnce(source,"const {createHash}=require('node:crypto');",
    "const {createHash}=require('node:crypto');\nconst {performance}=require('node:perf_hooks');");
  source=replaceOnce(source,' const user=await db.doc(\'users/\'+uid).get();',
    " const includeRoster=d.action==='syncSummary'&&d.includeRoster===true;\n const requestStarted=includeRoster?performance.now():0;\n const user=await db.doc('users/'+uid).get();");
  source=replaceOnce(source,' return db.runTransaction(async tx=>{',
    ' const transactionStarted=includeRoster?performance.now():0;\n const outcome=await db.runTransaction(async tx=>{\n  const roomReadStarted=includeRoster?performance.now():0;');
  source=replaceOnce(source,'  const t=ts.data(),pub=ps.data(),u=us.data(),s=state(t),requestHash=hash(JSON.stringify(d)),profiles=fs.data()?.profiles||[];',
    '  const roomReadMs=includeRoster?performance.now()-roomReadStarted:0;\n  const t=ts.data(),pub=ps.data(),u=us.data(),s=state(t),requestHash=hash(JSON.stringify(d)),profiles=fs.data()?.profiles||[];');
  source=replaceOnce(source,"  const quickRows=quick?(managedRows||(await tx.get(tr.collection('registrations'))).docs.map(doc=>({...doc.data(),registrationId:doc.id}))):null;",
    "  const registrationReadStarted=includeRoster?performance.now():0;\n  const quickRows=quick?(managedRows||(await tx.get(tr.collection('registrations'))).docs.map(doc=>({...doc.data(),registrationId:doc.id}))):null;\n  const registrationReadMs=includeRoster?performance.now()-registrationReadStarted:0;");
  source=replaceOnce(source,'   return {ok:true,communityParticipantCount};',`   const result={ok:true,communityParticipantCount};
   if(!includeRoster||Object.hasOwn(t,'scoreStorage'))return result;
   // This branch has already checked the current owner against both documents.
   // Only return the fields the room reader needs, never the registration rows.
   const room={data:projection.private.data,communityParticipantCount};
   for(const key of ['createdBy','ownerUid','createdByRole','eventAuthority','communityQuickRegistration',
     'refereeSeatsV1','refereeSeatNames','assignedStaffUids','refereeStationAssignments',
     'refereeStationNames','refereeStationRestrictionEnabled']){
    if(t[key]!==undefined)room[key]=t[key];
   }
   if(t.expiresAt)room.expiresAtMs=ms(t.expiresAt);
   return {...result,rosterReceipt:{code,room,timing:{roomReadMs,registrationReadMs}}};`);
  return replaceOnce(source," },d.action==='preview'?{readOnly:true}:undefined);",
    ` },d.action==='preview'?{readOnly:true}:undefined);
 if(outcome.rosterReceipt){
  const timing=outcome.rosterReceipt.timing;
  timing.transactionMs=performance.now()-transactionStarted;
  timing.serverMs=performance.now()-requestStarted;
 }
 return outcome;`);
}

module.exports={addFamilyRosterReceipt};

if(require.main===module){
  const [sourceFile]=process.argv.slice(2);
  if(!sourceFile)throw Error('pass the captured family-registration.js path');
  process.stdout.write(addFamilyRosterReceipt(require('node:fs').readFileSync(sourceFile,'utf8')));
}
