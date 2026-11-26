'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const sourceFiles=[
 'registration-flow-v3/admission.cjs','registration-flow-v3/api.cjs','registration-flow-v3/hold-core.cjs','registration-flow-v3/hold-service.cjs',
 'registration-flow-v3/permissions.cjs','registration-flow-v3/create-room.cjs','registration-flow-v3/summary-sync.cjs',
 'qr-checkin/backend/overlays/room-access-core.js','management-summary/functions/event-staff-core.cjs'
];
function stage(output){
 const dir=path.resolve(output);
 // A fresh destination prevents accidentally modifying a deployed source tree.
 fs.mkdirSync(dir,{recursive:false});
 for(const file of sourceFiles){
  const dest=path.join(dir,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
 }
 fs.copyFileSync(path.join(__dirname,'entrypoint.cjs'),path.join(dir,'index.cjs'));
 fs.copyFileSync(path.join(__dirname,'package.json'),path.join(dir,'package.json'));
 return dir;
}
if(require.main===module){if(process.argv.length!==3)throw Error('usage: node stage.cjs NEW_DIRECTORY');console.log(stage(process.argv[2]));}
module.exports={stage,sourceFiles};
