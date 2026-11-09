'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');

// Handler and entrypoint were read back from 00009-sep. The dependency
// fingerprints are the reviewed capture and must match the release input.
const sourceHashes=Object.freeze({
 "_qr_checkin/admin-firestore.cjs": "3c8c2abf2cb2f4142e0e8ec727e232e703d60f0a9a2449867c25464e1d8f850e",
 "_qr_checkin/guard-firestore.cjs": "b0d0027f0b79b845eb118c585bb8104d3590c1c18729737300f6fdf32d97d43b",
 "_qr_checkin/qr-checkin-fence.cjs": "556270ff967f083182c39b6ed6a331d06909ac66891fa9e3f7cd03356a257aab",
 "community-registration-policy.js": "93b6a5d2871a0f9b9908d91c0fa0d9f2a5c04b787ed50640570ad0c049d053e3",
 "community-registration-roster.js": "99af7082c103026e970bb7f85e02dbf8fc12ff4fda05f133c3fba71e2c43cc56",
 "index.js": "4ae89e877b1c1ed16e0ac38b55f4d09b6060fc70e5984e2c249b2bd545c3a938",
 "my-events-operation-proof.cjs": "e33b8d08f8653a546a7656fd529478f4938b258046a88a4fae3e4b337017d5a9",
 "my-events-writer-flags.cjs": "2ae9e7365190cdabebec5cbde7b3743fbd969e4442086d74dd515c6faf92297b",
 "onsite-waitlist/core.js": "0ddf2d490daf8cd416cf299bdc7acfb3f98dd02e61d3df0dbbf3b3c2f2dfa39c",
 "onsite-waitlist/owned.js": "649d5b78be40b89b88743b30c9ea4181957be6e1be0c6ef28aed5015e1c60433",
 "onsite-waitlist-writer-guards.js": "d35d101cab964d9210df2159e93a49d20aed39f0bdf6f6217a3e648db4141dba",
 "package.json": "19502c399dd7cca2443edc3335c6eff046cc8dbfb8e2f0491de94d1fbc2a83b5",
 "roster-service.js": "6458496cbaedaf0a4ff34162115301cde9e1a94b229fd16d2b13b688ecfc2acf"
});

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
