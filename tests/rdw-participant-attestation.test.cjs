const test=require('node:test'),assert=require('node:assert/strict');
const {attestParticipant}=require('../scripts/lib/rdw-participant-attestation.cjs');
const eventCode='BXH-TEST01',uid='fixture_account_2';
const room=players=>({code:eventCode,data:JSON.stringify({cloudCode:eventCode,players})});
const check=players=>attestParticipant({eventCode,expectedUid:uid,room:room(players)});
test('attests a real player only from canonical UID; never from identical names',()=>{
 const result=check([{id:'a',uid:'another-account',name:'Same Display Name'},{id:'b',uid,name:'Same Display Name'}]);
 assert.deepEqual(result,{ok:true,eventCode,playerIndex:1,playerId:'b',identitySource:'canonical-uid'});
});
test('refuses name-only, duplicate UID and mixed conflicting aliases',()=>{
 assert.equal(check([{name:'Same Display Name'}]).reason,'uid-not-in-room');
 assert.equal(check([{uid},{uid}]).reason,'uid-duplicate');
 assert.equal(check([{uid,accountUid:'someone-else'}]).reason,'uid-alias-conflict');
});
test('refuses guardian mapping or renamed room even with matching UID',()=>{
 assert.equal(check([{uid,guardianUid:'guardian'}]).reason,'guardian-or-family-player-needs-authoritative-mapping');
 assert.equal(attestParticipant({eventCode,expectedUid:uid,room:{code:'BXH-OTHER1',data:JSON.stringify({players:[{uid}]})}}).ok,false);
});
