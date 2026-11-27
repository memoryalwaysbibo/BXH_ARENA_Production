'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const pins=require('./writer-pins.json');
const edits={
 familyRegistration:[["  if(d.action!=='preview'&&t.registrationQueueVersion===2)throw Error('registration-queue-required');","  if(d.action!=='preview'&&(t.registrationFlowVersion===3||pub.registrationFlowVersion===3))throw Error('registration-v3-required');"]],
 registrationRosterService:[["  if(t.registrationQueueVersion===2)throw Error('registration-queue-required');","  if(t.registrationFlowVersion===3||pub.registrationFlowVersion===3)throw Error('registration-v3-required');"]],
 promoteSeatedRegistration:[["  if(t.registrationQueueVersion===2)fail('registration-queue-required');","  if(t.registrationFlowVersion===3||pub.registrationFlowVersion===3)fail('registration-v3-required');"]],
 registrationInvitations:[["   if(room.data().registrationQueueVersion===2)throw Error('registration-queue-required');","   if(room.data().registrationFlowVersion===3)throw Error('registration-v3-required');"],["  if(t.registrationQueueVersion===2)throw Error('registration-queue-required');","  if(t.registrationFlowVersion===3)throw Error('registration-v3-required');"]],
 lotteryRegistration:[[" if(room?.registrationQueueVersion===2)throw Error('registration-queue-required');"," if(room?.registrationFlowVersion===3||pub?.registrationFlowVersion===3)throw Error('registration-v3-required');"]],
 manageRegistrationSelection:[[" if(room?.registrationQueueVersion===2)throw Error('registration-queue-required');"," if(room?.registrationFlowVersion===3||pub?.registrationFlowVersion===3)throw Error('registration-v3-required');"]],
 manageOnsiteWaitlist:[["      if (change && aggregate.tournament?.registrationQueueVersion === 2) throw new DrawError('registration-queue-required', 409);","      if (change && aggregate.tournament?.registrationFlowVersion === 3) throw new DrawError('registration-v3-required', 409);"]],
 syncRegistrationRoster:[["    // Shared by trigger and backfill. A delayed event must inspect current docs.","    if(room.registrationFlowVersion===3||pub.registrationFlowVersion===3)return {ok:false,reason:'registration-v3-managed'};"]],
 backfillRegistrationRoster:[["    // Shared by trigger and backfill. A delayed event must inspect current docs.","    if(room.registrationFlowVersion===3||pub.registrationFlowVersion===3)return {ok:false,reason:'registration-v3-managed'};"]],
 teamRegistration:[["    assertLegacyRosterWritable(t,pub,s);","    if(t.registrationFlowVersion===3||pub.registrationFlowVersion===3)throw Error('registration-v3-required');"]]
};
function prepare(name,source){
 const pin=pins[name];
 if(!pin||createHash('sha256').update(source).digest('hex')!==pin.sha256)throw Error('Unreviewed writer source: '+name);
 for(const [anchor,guard] of edits[name]){
  if(source.split(anchor).length!==2)throw Error('Writer anchor changed: '+name);
  source=source.replace(anchor,guard+'\n'+anchor);
 }
 return source;
}
if(require.main===module){
 const [,,capture,output]=process.argv;if(!capture||!output)throw Error('Usage: node prepare-writers.cjs <captured-source-directory> <new-output-directory>');
 fs.mkdirSync(output);
 for(const [name,pin] of Object.entries(pins)){
  const src=fs.readFileSync(path.join(capture,name,pin.path),'utf8');
  const dest=path.join(output,name,pin.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,prepare(name,src));
 }
}
module.exports={prepare};
