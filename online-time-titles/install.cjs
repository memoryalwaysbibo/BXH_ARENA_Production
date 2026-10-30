'use strict';
const fs=require('node:fs'),path=require('node:path');
// Build an isolated candidate from a separately captured backend. This does not
// fetch credentials, deploy Functions, initialize definitions, or enable flags.
function install(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  if(fs.existsSync(destination))throw Error('destination-must-not-exist');
  const indexPath=path.join(source,'index.js');
  let index=fs.readFileSync(indexPath,'utf8');
  if(index.includes('online_time_v1')||index.includes('online-time-titles/service.cjs'))throw Error('already-installed');
  for(const pattern of [/async function awardTitle\(/,/function conditionProgress\(definition, stats\)/,/case "total_checkins":/,/const EXECUTABLE_TITLE_CONDITIONS = new Set\(/,/const \{onDocumentCreated, onDocumentWritten\}/]){
    if(!pattern.test(index))throw Error('backend-contract-changed:'+pattern.source);
  }
  const anchor='    case "total_checkins": return Number(stats.totalCheckInDays || 0);';
  if(index.split(anchor).length!==2)throw Error('condition-anchor-ambiguous');
  index=index.replace(anchor,'    case "total_online_minutes": return Math.floor(Number(stats.officialOnlineTimeMs || 0) / 60000);\n'+anchor);
  index+='\n// Online time titles: same trusted UID presence source, no daily time cap.\n'+
    'EXECUTABLE_TITLE_CONDITIONS.add("total_online_minutes");\n'+
    'const onlineTimeTitleService=require("./online-time-titles/service.cjs").createService(db,{awardTitle});\n'+
    'exports.onlineTimeTitlePresenceWritten=onDocumentWritten({document:"onlinePresence/{uid}",region:REGION,retry:true},onlineTimeTitleService);\n';
  fs.cpSync(source,destination,{recursive:true});
  fs.mkdirSync(path.join(destination,'online-time-titles'));
  for(const file of ['domain.cjs','service.cjs','backfill.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(destination,'online-time-titles',file));
  fs.writeFileSync(path.join(destination,'index.js'),index);
  return {candidateOnly:true,deployAllowed:false,newExport:'onlineTimeTitlePresenceWritten',historicalBackfill:false};
}
if(require.main===module){if(process.argv.length!==4)throw Error('usage: node install.cjs CAPTURED_SOURCE NEW_DESTINATION');console.log(JSON.stringify(install(process.argv[2],process.argv[3])));}
module.exports={install};
