'use strict';
// Firestore Admin SDK transaction adapter for the existing RDW reference contract.
// Emulator-only harness: production integration remains disabled.
const {commitStart}=require('./rdw-atomic-start-reference.cjs');
async function startInEmulator({db,eventRef,auditRef,snapshotRef,...params}){
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('emulator-required');
 if(!db||typeof db.runTransaction!=='function')throw Error('firestore-required');
 return db.runTransaction(async tx=>commitStart({tx,eventRef,auditRef,snapshotRef,...params}));
}
module.exports={startInEmulator};
