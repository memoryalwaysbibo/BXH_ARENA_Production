'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {install}=require('../install.cjs');
// Deliberately synthetic parser fixture; not a deployed-source parity claim.
const fixture=`const {onDocumentCreated, onDocumentWritten}=require('firebase-functions/v2/firestore');
async function awardTitle(){}
function conditionProgress(definition, stats){switch(definition.conditionType){
    case "total_checkins": return Number(stats.totalCheckInDays || 0);
}}
const EXECUTABLE_TITLE_CONDITIONS = new Set([]);
`;
test('candidate builder adds condition and trigger without modifying captured source',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'online-time-install-'));
  try{
    const source=path.join(tmp,'source'),out=path.join(tmp,'candidate');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.js'),fixture);
    const result=install(source,out);assert.equal(result.deployAllowed,false);
    assert.equal(fs.readFileSync(path.join(source,'index.js'),'utf8'),fixture);
    const built=fs.readFileSync(path.join(out,'index.js'),'utf8');assert.match(built,/total_online_minutes/);assert.match(built,/onlineTimeTitlePresenceWritten/);
    assert(fs.existsSync(path.join(out,'online-time-titles/service.cjs')));
    assert.throws(()=>install(source,out),/destination-must-not-exist/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('unknown backend contracts fail before creating candidate files',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'online-time-install-'));
  try{
    const source=path.join(tmp,'source'),out=path.join(tmp,'candidate');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.js'),'unrecognized');
    assert.throws(()=>install(source,out),/backend-contract-changed/);assert(!fs.existsSync(out));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
