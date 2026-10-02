'use strict';

const fs = require('node:fs');
const html = fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');

function mustInclude(text, message){
  if(!html.includes(text)) throw new Error(message);
}

mustInclude(
  'if(community){ delete registrationFields.assignedStaffUids; delete registrationFields.refereeStationAssignments; delete registrationFields.refereeStationNames; delete registrationFields.refereeStationUids; delete registrationFields.refereeStationRestrictionEnabled; }',
  'Community sync must remove staff/referee fields before payload construction'
);

mustInclude(
  'if(!community){\n              privatePayload.assignedStaffUids=data.meta.assignedStaffUids;',
  'Community transaction rebase must not re-add assignedStaffUids'
);

mustInclude(
  'delete privatePayload.assignedStaffUids;\n              delete privatePayload.refereeStationAssignments;',
  'Community transaction rebase must explicitly strip admin-only top-level fields'
);

console.log('PASS community room cloud sync respects Production Rules contract');
