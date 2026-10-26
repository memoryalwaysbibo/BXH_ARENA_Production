'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('modules/main-app/core.js','utf8');
const begin=source.indexOf('  if(action==="start-tournament"){');
const end=source.indexOf('  if(action==="reset-bracket"){',begin);
if(begin<0||end<0)throw Error('start-handler-not-found');
const handler=source.slice(begin,end);
test('ranked team cannot fall into the legacy team start handler',()=>{
 const guard=handler.indexOf('state.meta?.ladderMode==="ranked"&&state.meta?.battleMode==="team"');
 const legacy=handler.indexOf('if(state.meta.battleMode==="team"){');
 assert.ok(guard>=0&&guard<legacy);
});
test('ranked individual start requires backend bridge before local startedAt save',()=>{
 const ranked=handler.indexOf('if(state.meta?.ladderMode==="ranked"){');
 const local=handler.indexOf('state.startedAt=Date.now();',ranked);
 assert.ok(ranked>=0&&local>ranked);
 const branch=handler.slice(ranked,local);
 assert.match(branch,/window\.BXHRdwStartBridge/);
 assert.match(branch,/typeof bridge\?\.start!=="function"/);
 assert.match(branch,/await bridge\.start\(/);
 assert.match(branch,/if\(result\?\.ok!==true\)/);
 assert.match(branch,/return;\s*}\s*const beforeStart=/);
 assert.doesNotMatch(branch,/state\.startedAt\s*=/);
 assert.doesNotMatch(branch,/await saveState\(/);
});
test('general tournament retains original local start with court assignments',()=>{
 assert.match(handler,/const beforeStart=JSON\.parse\(JSON\.stringify\(state\)\);\s*state\.startedAt=Date\.now\(\);\s*rebuildCourtAssignments\(\);/);
 assert.match(handler,/const synced=await saveState\(\);/);
});
