'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {fixture,NOW,code}=require('./fixture.cjs'),{invoke,count}=require('./probe.cjs'),{load}=require('./hosting-probe.cjs');
function extend(f){const doc=f.m.db.doc;f.m.db.doc=p=>({...doc(p),set:async(v,o)=>f.m.put(p,o?.merge?{...f.m.rows.get(p),...v}:v)});return f;}
function legacy(qr=false,community=false){const f=extend(fixture({bucket:false,qr})),s={...f.state,archiveStatus:'completed',completedAt:NOW};if(community){s.meta={...s.meta,eventAuthority:'community'};s.expiresAtMs=NOW+5000;}
 f.m.put('tournaments/'+code,{...f.top,data:JSON.stringify(s),...(community?{eventAuthority:'community',expiresAt:NOW+5000}:{})});if(community)f.m.put('publicTournaments/'+code,{...f.pub,expiresAt:NOW+5000});return f;}
function relevant(f){return [...f.m.rows].filter(([p])=>!p.startsWith('hostAwardQueue/')).sort(([a],[b])=>a.localeCompare(b));}
const request={auth:{uid:'admin'},data:{uid:'another-user'}};
(async()=>{let checks=0;
 for(const qr of [false,true])for(const community of [false,true]){
  const old=legacy(qr,community),fresh=legacy(qr,community);const a=await load(old,'host-sync',false).syncMyHostingProgress(request),b=await load(fresh,'host-sync',true).syncMyHostingProgress(request);assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));assert.equal(b.completedHostedCount,1);assert.deepEqual(relevant(fresh),relevant(old));assert(!fresh.m.rows.has('hostStats/another-user'));checks++;
 }
 for(const qr of [false,true]){
  const f=extend(fixture({qr}));await invoke(f);const beforeBuckets=f.buckets.map(b=>JSON.stringify(f.m.rows.get('tournaments/'+code+'/matchBuckets/'+b.bucketId)));const fn=load(f,'host-sync',true).syncMyHostingProgress;
  const [a,b]=await Promise.all([fn(request),fn(request)]);assert.equal(a.completedHostedCount,1);assert.equal(b.completedHostedCount,1);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);assert(f.m.rows.has('hostAwardQueue/admin'));assert.deepEqual(f.buckets.map(b=>JSON.stringify(f.m.rows.get('tournaments/'+code+'/matchBuckets/'+b.bucketId))),beforeBuckets);assert.equal(f.m.writes.filter(w=>/ladderPlayers|ladderTransactions/.test(w.path)).length,0);checks++;
 }
 for(const mode of ['no-auth','inactive','revoked-after-preflight','corrupt-certificate','migration','wrong-ledger']){
  const f=extend(fixture());await invoke(f);f.m.put('hostStats/admin',{completedHostedCount:7});
  if(mode==='inactive')f.m.put('users/admin',{active:false,role:'admin'});
  if(mode==='corrupt-certificate'){const p='tournaments/'+code,t=f.m.rows.get(p);f.m.put(p,{...t,bucketCompletion:{...t.bucketCompletion,stateDigest:'bad'}});}
  if(mode==='migration')f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),bucketMigration:null});
  if(mode==='wrong-ledger')f.m.put('hostCompletionLedger/'+code,{ownerUid:'other'});
  if(mode==='revoked-after-preflight'){const run=f.m.db.runTransaction;f.m.db.runTransaction=async cb=>{f.m.put('users/admin',{active:false,role:'admin'});return run(cb);};}
  const fn=load(f,'host-sync',true).syncMyHostingProgress;await assert.rejects(()=>fn(mode==='no-auth'?{}:request));assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,7);assert(!f.m.rows.has('hostAwardQueue/admin'));checks++;
 }
 {const f=extend(fixture());await invoke(f);const fn=load(f,'host-sync',true).syncMyHostingProgress;await Promise.all([count(f),fn(request),count(f)]);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);checks++;}
 {const f=legacy();const result=await load(f,'host-sync',true).syncMyHostingProgress(request);assert.equal(result.completedHostedCount,1);f.m.remove('tournaments/'+code);const next=await load(f,'host-sync',true).syncMyHostingProgress(request);assert.equal(next.completedHostedCount,0);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,0);checks++;}
 console.log(JSON.stringify({hostSyncChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
