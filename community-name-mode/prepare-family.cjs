'use strict';
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');

// Apply to an independently captured live handler, including its existing guards.
// Require the operator's expected digest; never substitute an older full handler.
function prepareFamilySource(source,expectedSha256){
  const digest=createHash('sha256').update(source).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(expectedSha256||'')||digest!==expectedSha256)throw Error('family-source-baseline-mismatch');
  const before="const realName=child?child.name:u.realName,gameId=child?child.nickname:u.gameId||u.nickname||'',nameMode=pub.participantNameMode==='gameId'?'gameId':'realName';rows.push({registrationId:key,childId:child?.id||null,displayCode:child?.displayCode||u.playerId||'',participantName:nameMode==='gameId'?(gameId||realName):realName";
  const after="const identity=t.eventAuthority==='community'&&pub.eventAuthority==='community'?require('./participant-names.js').participantIdentity({eventAuthority:'community',ladderMode:t.ladderMode==='ranked'||pub.ladderMode==='ranked'?'ranked':'general',participantNameMode:pub.participantNameMode},u,child):null;const realName=identity?identity.realName:child?child.name:u.realName,gameId=identity?identity.gameId:child?child.nickname:u.gameId||u.nickname||'',nameMode=identity?identity.nameMode:pub.participantNameMode==='gameId'?'gameId':'realName';rows.push({registrationId:key,childId:child?.id||null,displayCode:child?.displayCode||u.playerId||'',participantName:identity?identity.displayName:nameMode==='gameId'?(gameId||realName):realName";
  if(source.split(before).length!==2)throw Error('family-name-policy-anchor-mismatch');
  return source.replace(before,after);
}
if(require.main===module)process.stdout.write(prepareFamilySource(readFileSync(process.argv[2],'utf8'),process.argv[3]));
module.exports={prepareFamilySource};
