const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const method=html.slice(html.indexOf('    async settleLadderTournament('),html.indexOf('    async adjustLadderPoints('));
let received=null;
const context=vm.createContext({
  window:{engagementService:{settleLadder:async payload=>{received=payload;return {ok:true,seasonId:'S0',results:[]};}}},
  cloudEnabled:true,
  authHandle:{currentUser:{uid:'admin'}},
});
vm.runInContext('var api={'+method+'};',context);

(async()=>{
  const callerPayload={participants:[{pointsEarned:999999}]};
  const result=await context.api.settleLadderTournament('bxh-f8fqqr',callerPayload);
  assert.equal(result.ok,true);
  assert.equal(received.code,'BXH-F8FQQR');
  assert.equal(Object.keys(received).length,1);
  assert.equal(Object.hasOwn(received,'participants'),false,'browser-calculated points must not cross the trust boundary');

  context.window.engagementService.settleLadder=async()=>{throw new Error('season-ended');};
  await assert.rejects(()=>context.api.settleLadderTournament('BXH-F8FQQR',callerPayload),/season-ended/);
  console.log('PASS official ladder settlement delegates code-only to the trusted callable and preserves backend errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
