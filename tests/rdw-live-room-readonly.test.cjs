const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../scripts/rdw-live-room-readonly.cjs'),'utf8');
test('live room audit is read-only and omits full UID and player details',()=>{
 assert.match(source,/\.doc\('tournaments\/'\+eventCode\)\.get\(\)/);
 assert.doesNotMatch(source,/\.set\(|\.update\(|\.create\(|\.delete\(|runTransaction\(|\.add\(/);
 assert.doesNotMatch(source,/JSON\.stringify\(room|JSON\.stringify\(state/);
 assert.match(source,/participantMatched/);
 assert.match(source,/project!=='bxh-arena'/);
});
