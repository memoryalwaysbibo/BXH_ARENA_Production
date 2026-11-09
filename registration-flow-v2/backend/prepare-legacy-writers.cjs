'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const releaseInputs=require('../release-inputs.json');

const writers={
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
 if(!Object.hasOwn(writers,name))throw Error('unsupported-legacy-writer');
 const {file,anchor,guard}=writers[name];
 const expected=releaseInputs[name].files[file];
 if(createHash('sha256').update(source).digest('hex')!==expected)
  throw Error('legacy-writer-source-baseline-mismatch: '+name);
 if(source.split(anchor).length!==2)throw Error('legacy-writer-patch-mismatch: '+name);
 // The handlers have already authenticated the request and returned any
 // matching receipt. Check the room read in the transaction before a new write.
 return source.replace(anchor,guard+'\n'+anchor);
}

if(require.main===module){
 if(process.argv.length!==4)throw Error('Usage: node prepare-legacy-writers.cjs <function-name> <original-handler>');
 const [, ,name,file]=process.argv;
 process.stdout.write(prepareLegacyWriterSource(name,readFileSync(file,'utf8')));
}

module.exports={prepareLegacyWriterSource};
