const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalUid,resolveRoster}=require('../scripts/lib/rdw-canonical-identity.cjs');
test('consistent account UID aliases identify the same player',()=>{assert.deepEqual(canonicalUid({registrationUid:'u1',accountUid:'u1',playerUid:'u1'}),{ok:true,uid:'u1'});});
test('conflicting UID aliases fail closed',()=>{assert.equal(canonicalUid({registrationUid:'u1',accountUid:'u2'}).reason,'uid-alias-conflict');});
test('guardian and family player are never inferred as the competitor',()=>{assert.equal(canonicalUid({guardianUid:'parent',registrationUid:'parent',familyPlayerId:'child'}).ok,false);});
test('virtual and duplicate players cannot form trusted roster',()=>{assert.equal(resolveRoster([{id:'virtual'},{uid:'u2'}]).ok,false);assert.equal(resolveRoster([{uid:'u1'},{registrationUid:'u1'}]).reason,'duplicate-uid');});
test('valid two-account roster is read-only',()=>{const players=[{accountUid:'u1'},{registrationUid:'u2'}],before=JSON.stringify(players);assert.deepEqual(resolveRoster(players),{ok:true,uids:['u1','u2']});assert.equal(JSON.stringify(players),before);});
