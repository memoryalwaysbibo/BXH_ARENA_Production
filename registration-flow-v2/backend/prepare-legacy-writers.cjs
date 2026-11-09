'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const releaseInputs=require('../release-inputs.json');

const selectionHashes={
 lotteryRegistration:'d4fc39819cd27ffa27a97f3d7253737a16d66b672191c376b8ee94ceb15ee17d',
 manageRegistrationSelection:'026833cc060963c12f475151a2d4c96537c179f1eccafa70d7271d761d0ec02b',
};
const selectionImport="const {assertLegacyRosterWritable}=require('./onsite-waitlist-writer-guards');";
const guardedSelectionImport=`const {assertLegacyRosterWritable:assertExistingRosterWritable}=require('./onsite-waitlist-writer-guards');
function assertLegacyRosterWritable(room,pub,state){
 assertExistingRosterWritable(room,pub,state);
 if(room?.registrationQueueVersion===2)throw Error('registration-queue-required');
}`;

const writers={
 promoteSeatedRegistration:{
  sha256:'ef07b2c70fe61b984a50bc2d5f27142f8cec927eb8e57aaac7711702f0881de5',
  anchor:"  if(!local&&reg.status!=='waitlist')fail('not-waitlist');",
  guard:"  if(t.registrationQueueVersion===2)fail('registration-queue-required');",
 },
 manageOnsiteWaitlist:{
  sha256:'099abfc664d3821ffa96d22116c2fc3b66f2453c52a9ea3c4a67d970f3db59fa',
  anchor:'      const attendance=await prepare({tx,ref:tr,aggregate,output,uid,code});',
  guard:"      if (change && aggregate.tournament?.registrationQueueVersion === 2) throw new DrawError('registration-queue-required', 409);",
 },
 familyRegistration:{
  file:'family-registration.js',
  anchor:'  const onsiteOwned=Onsite.onsiteWaitlistOwned(t,pub,s);',
  guard:"  if(d.action!=='preview'&&t.registrationQueueVersion===2)throw Error('registration-queue-required');",
 },
 registrationRosterService:{
  file:'roster-service.js',
  anchor:"  const prestartCancellation=d.action==='cancel'&&intent==='admin'&&isManager&&!managed;",
  guard:"  if(t.registrationQueueVersion===2)throw Error('registration-queue-required');",
 },
};

function prepareLegacyWriterSource(name,source){
 if(name==='registrationInvitations'){
  const expected='c655efe635e6278bb1060840871f16e32ef78659b7b360f88152480ecf6ba9ef';
  const invite='  await db.runTransaction(async tx=>{const [prior,reg,ss]';
  const accept="  const currentActor=(await tx.get(db.doc('users/'+uid))).data();";
  verifySource(name,source,expected,invite);
  if(source.split(accept).length!==2)throw Error('legacy-writer-patch-mismatch: '+name);
  // The send transaction needs a fresh ownership read. Existing replies
  // and acceptance of an already registered player take the original path.
  return source.replace(invite,`  await db.runTransaction(async tx=>{
   const room=await tx.get(tr);
   if(!room.exists)throw Error('not-found');
   if(room.data().registrationQueueVersion===2)throw Error('registration-queue-required');
   const [prior,reg,ss]`).replace(accept,
    "  if(t.registrationQueueVersion===2)throw Error('registration-queue-required');\n"+accept);
 }
 if(Object.hasOwn(selectionHashes,name)){
  // Lottery and selection management are outside V2. Every mutating path
  // already reads the private room and calls this guard before its writes.
  verifySource(name,source,selectionHashes[name],selectionImport);
  return source.replace(selectionImport,guardedSelectionImport);
 }
 if(!Object.hasOwn(writers,name))throw Error('unsupported-legacy-writer');
 const {file,anchor,guard,sha256}=writers[name];
 const expected=sha256??releaseInputs[name].files[file];
 verifySource(name,source,expected,anchor);
 // The handlers have already authenticated the request and returned any
 // matching receipt. Check the room read in the transaction before a new write.
 return source.replace(anchor,guard+'\n'+anchor);
}

function verifySource(name,source,expected,anchor){
 if(createHash('sha256').update(source).digest('hex')!==expected)
  throw Error('legacy-writer-source-baseline-mismatch: '+name);
 if(source.split(anchor).length!==2)throw Error('legacy-writer-patch-mismatch: '+name);
}

if(require.main===module){
 if(process.argv.length!==4)throw Error('Usage: node prepare-legacy-writers.cjs <function-name> <original-source-file>');
 const [, ,name,file]=process.argv;
 process.stdout.write(prepareLegacyWriterSource(name,readFileSync(file,'utf8')));
}

module.exports={prepareLegacyWriterSource};
