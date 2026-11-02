'use strict';
// Deliberately no Firestore SDK, write mode, callable request or credential access.
const preview=require('../referee-certificates/functions/initial-preview.json');
if(preview.people.length!==18||new Set(preview.people.map(p=>p.uid)).size!==18)throw Error('invalid-initial-candidate');
console.log(JSON.stringify(preview,null,2));
