const test=require('node:test'),assert=require('node:assert/strict');
const {buildAudit,appendAudit}=require('../scripts/lib/rdw-pass-audit.cjs');
const base={eventCode:'BXH-TEST',drawRevision:3,actorUid:'host',reason:'rdw-timeout',serverTime:12345,idempotencyKey:'BXH-TEST:3:pass'};
function fixture(){let stored=null,creates=0;const tx={get:async()=>({exists:stored!==null,data:()=>stored}),create:(_ref,v)=>{stored=v;creates++;}};return {tx,get creates(){return creates;}};}
test('PASS audit is append-only and idempotent',async()=>{const f=fixture(),record=buildAudit(base);assert.equal((await appendAudit({tx:f.tx,auditRef:{id:'x'},record})).created,true);assert.equal((await appendAudit({tx:f.tx,auditRef:{id:'x'},record})).created,false);assert.equal(f.creates,1);await assert.rejects(appendAudit({tx:f.tx,auditRef:{id:'x'},record:{...record,reason:'other'}}),/audit-idempotency-conflict/);});
test('audit requires actor, event, revision, reason and time',()=>{for(const patch of [{actorUid:''},{eventCode:''},{reason:''},{drawRevision:-1},{serverTime:0},{idempotencyKey:''}])assert.throws(()=>buildAudit({...base,...patch}));});
