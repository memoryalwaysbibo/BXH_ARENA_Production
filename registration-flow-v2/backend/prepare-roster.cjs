'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');

// Handler and entrypoint were read back from 00009-sep. The dependency
// fingerprints are the reviewed capture and must match the release input.
const {files:sourceHashes}=require('../release-inputs.json').registrationRosterService;

function prepareRosterSource(sourceRoot,FieldValue){
 const root=resolve(sourceRoot);
 for(const [name,digest] of Object.entries(sourceHashes)){
  const bytes=readFileSync(join(root,name));
  if(createHash('sha256').update(bytes).digest('hex')!==digest)
   throw Error('roster-source-baseline-mismatch: '+name);
 }
 // The deployment entrypoint normally adds this guard before dispatch. V2
 // adds it to the queue's fenced store so both guards share one transaction.
 const {guardFirestore}=require(join(root,'_qr_checkin/guard-firestore.cjs'));
 const {createRosterService,manager,promotionManager}=require(join(root,'roster-service.js'));
 const {playerRosterCancellationProof}=require(join(root,'my-events-writer-flags.cjs'));
 return {
  rosterFactory:store=>createRosterService(guardFirestore(store),FieldValue,Date.now,{
   myEventsProofEnabled:playerRosterCancellationProof===true,
  }),
  canCancel:manager,
  canPromoteUnlimited:promotionManager,
 };
}

module.exports={prepareRosterSource};
