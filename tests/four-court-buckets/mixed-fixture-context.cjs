'use strict';
const B=require('../../referee-seats/functions/bucket-state.cjs');
// Variants share one Emulator in CI. Receipt/audit subcollections survive root
// replacement, so each variant requires its own room and migration epoch.
function mixedFixtureContext(players,storageSchema,deferredPublic=false){
 if(![128,320].includes(players)||![B.schema,B.perCourtSchema].includes(storageSchema)||deferredPublic&&storageSchema!==B.perCourtSchema)throw Error('invalid-mixed-fixture');
 const variant=storageSchema===B.schema?'v1':deferredPublic?'v2-async':'v2-inline';
 return {code:'BXH-MIX'+players+(variant==='v1'?'':variant==='v2-inline'?'V2':'V2A'),epoch:'mixed-pass-epoch-'+players+'-'+variant};
}
module.exports={mixedFixtureContext};
