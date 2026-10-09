'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createService}=require('../hunter-clash/arena/service.cjs'),{createHandler}=require('../hunter-clash/arena/callable.cjs'),adapter=require('../hunter-clash/arena/adapter.js'),{memory}=require('./helpers/arena-pk-memory.cjs');
function fixture(){const m=memory();let time=1700000000000,seq=0;for(const uid of ['a','b','c','admin'])m.data.set('users/'+uid,{active:true,role:uid==='admin'?'super_admin':'player',displayName:uid});m.data.set('systemSettings/hunterClash',{enabled:true,environment:adapter.ENV,allowedUids:['a','b','c'],pairingTtlMs:120000,rules:{version:adapter.VERSION,targetScore:4}});const auth={app:{options:{projectId:m.db.projectId}},verifyIdToken:async token=>{if(!['a','b','c','admin'].includes(token))throw Error('unauthenticated');return {uid:token};}};const service=createService({db:m.db,auth,clock:()=>++time});const call=(uid,op,input={})=>service.run(uid,op,{...input,...(!['getMyHistory','getChallenge'].includes(op)?{requestId:'r'+(++seq)}:{})});return {...m,auth,service,call};}
async function start(f,count=1){const out=await f.call('a','createChallenge',{matchCount:count});let c=(await f.call('b','acceptCode',{pairingCode:out.pairingCode,expectedRevision:0})).challenge;for(const uid of ['a','b'])c=(await f.call(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;return c;}
async function score(f,c){for(let i=0;i<2;i++)c=(await f.call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'a',finish:'burst'})).challenge;return c;}
async function finish(f,c){for(const uid of ['a','b'])c=(await f.call(uid,'confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})).challenge;return c;}
test('same-project boundary, no sandbox tokens, actor and peer revocation on reads and writes',async()=>{const f=fixture();assert.throws(()=>createService({db:{...f.db,projectId:'bxh-hc-test'},auth:f.auth}),/project-mismatch/);await assert.rejects(f.call('bad','createChallenge'),/unauthenticated/);let c=await start(f);await assert.rejects(f.call('c','getChallenge',{challengeId:c.challengeId}),/participant-required/);f.data.get('users/b').active=false;await assert.rejects(f.call('a','getChallenge',{challengeId:c.challengeId}),/account-unavailable/);await assert.rejects(f.call('b','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'a',finish:'burst'}),/account-unavailable/);f.data.get('systemSettings/hunterClash').enabled=false;await assert.rejects(f.call('a','getMyHistory'),/closed/);});
test('QR/4-code pairing, stale concurrent score, dispute correction, waiting and atomic dual history',async()=>{const f=fixture();let c=await start(f);const input={challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'b',finish:'extreme'};c=(await f.call('a','recordRound',input)).challenge;await assert.rejects(f.call('a','recordRound',input),/revision-conflict/);c=(await f.call('b','dispute',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;assert.equal(c.status,'score_review');c=(await f.call('a','undoRound',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;assert.equal(c.corrections.length,1);c=(await f.call('a','resumeReview',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;c=await score(f,c);c=(await f.call('a','confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})).challenge;assert.equal(c.status,'final_pending');assert.equal(f.data.has('arenaPKPlayers/a'),false);const finalInput={challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision,requestId:'final'};const result=await f.service.run('b','confirmFinish',finalInput);assert.equal(result.challenge.status,'completed');assert.deepEqual(await f.service.run('b','confirmFinish',finalInput),result);for(const uid of ['a','b']){const h=(await f.call(uid,'getMyHistory')).history;assert.equal(h.total,1);const r=adapter.adapt(h.rows,uid)[0];assert.equal(r.analyzable,true);assert.equal(r.isWin,uid==='a');assert.equal(r.scoreFor,uid==='a'?4:0);assert.equal(r.corrections.length,1);}assert.equal([...f.data.keys()].some(k=>/^(ladder|playerStats|title|mailbox|users\/[^/]+\/earned)/.test(k)),false);});
test('full 51 game series, pagination generation fence, administrator tombstones and no resurrection',async()=>{const f=fixture();let c=await start(f,51);for(let i=0;i<51;i++){c=await score(f,c);if(i<50)c=(await f.call('a','nextGame',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;}c=await finish(f,c);const first=(await f.call('a','getMyHistory')).history;assert.equal(first.rows.length,50);assert.equal(first.total,51);const second=(await f.call('a','getMyHistory',{cursor:first.nextCursor,generation:first.generation})).history;assert.equal(second.rows.length,1);assert.equal(adapter.adapt([...first.rows,...second.rows],'a').length,51);await assert.rejects(f.call('b','revokeChallenge',{challengeId:c.challengeId,expectedRevision:c.revision,reason:'錯誤比分'}),/admin-required/);await f.call('admin','revokeChallenge',{challengeId:c.challengeId,expectedRevision:c.revision,reason:'錯誤比分'});await assert.rejects(f.call('a','getMyHistory',{cursor:first.nextCursor,generation:first.generation}),/history-changed/);const after=(await f.call('a','getMyHistory')).history;assert.equal(after.total,0);assert.equal(adapter.adapt([...first.rows,...second.rows,...after.rows],'a').length,1);const tail=(await f.call('a','getMyHistory',{cursor:after.nextCursor,generation:after.generation})).history;assert.equal(adapter.adapt([...first.rows,...second.rows,...after.rows,...tail.rows],'a').length,0);});
test('adapter rejects unknown source/version, marks bad rounds unavailable, detects conflicts and duplicate event revision',async()=>{const f=fixture();let c=await finish(f,await score(f,await start(f)));const row=(await f.call('a','getMyHistory')).history.rows[0];assert.throws(()=>adapter.record({...row,environment:'sandbox'},'a'),/source/);assert.throws(()=>adapter.record({...row,rules:{version:'unknown',targetScore:4}},'a'),/completion/);const wrong=structuredClone(row);wrong.game.rounds[0].points=33;assert.equal(adapter.record(wrong,'a').analyzable,false);const duplicate=structuredClone(row);duplicate.game.rounds[1].roundRevision=duplicate.game.rounds[0].roundRevision;assert.equal(adapter.record(duplicate,'a').analyzable,false);const a=adapter.record(row,'a');assert.throws(()=>adapter.latest([a,{...a,scoreFor:5}]),/revision-conflict/);});
test('strict capability consumption, code attempts rate limit, idempotency fingerprint',async()=>{const f=fixture(),created=await f.call('a','createChallenge');const base={challengeId:created.challenge.challengeId,expectedRevision:0};await assert.rejects(f.call('b','accept',{...base,pairingToken:'x'.repeat(43)}),/pairing-unavailable/);await f.call('b','accept',{...base,pairingToken:created.pairingToken});await assert.rejects(f.call('c','acceptCode',{pairingCode:created.pairingCode,expectedRevision:0}),/pairing-unavailable/);for(let i=0;i<10;i++)await assert.rejects(f.call('a','acceptCode',{pairingCode:'AAAA',expectedRevision:0}),/pairing-unavailable/);await assert.rejects(f.call('a','acceptCode',{pairingCode:'AAAA',expectedRevision:0}),/pairing-rate-limited/);await f.service.run('b','createChallenge',{requestId:'same',matchCount:1});await assert.rejects(f.service.run('b','createChallenge',{requestId:'same',matchCount:2}),/request-id-reused/);});
test('callable requires Auth/App Check and raw bearer, payload cannot assert UID/privileges',async()=>{class HTTPS extends Error{constructor(code,message){super(message);this.code=code;}}const handler=createHandler({run:async()=>({ok:true})},HTTPS);for(const request of [{},{auth:{uid:'a'}},{auth:{uid:'a'},app:{},data:{operation:'createChallenge',input:{}}}])await assert.rejects(handler(request),/unauthenticated/);await assert.rejects(handler({auth:{uid:'a'},app:{},rawRequest:{headers:{authorization:'Bearer a'}},data:{operation:'createChallenge',uid:'admin'}}),/invalid-input/);});
test('history cache holds partial pages, does not invent zero, fences account changes',async()=>{const context={globalThis:null,Date,Promise,BXHArenaPKAdapter:adapter};context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync('hunter-clash/arena/history.js','utf8'),context);const f=fixture();await finish(f,await score(f,await start(f)));const row=(await f.call('a','getMyHistory')).history.rows[0];let resolve;const store=context.BXHArenaPKHistory.createHistory({transport:async(op,input,{uid})=>{if(input.cursor)throw Error('offline');return {history:{uid,environment:adapter.ENV,total:2,generation:1,rows:[row],nextCursor:'page2'}};}});store.session('a');const state=await store.load();assert.equal(state.status,'partial');assert.notEqual(state.status,'empty');const stale=context.BXHArenaPKHistory.createHistory({transport:()=>new Promise(r=>resolve=r)});stale.session('a');const work=stale.load();stale.session('b');resolve({history:{uid:'a',environment:adapter.ENV,total:0,generation:0,rows:[],nextCursor:null}});await work;assert.equal(stale.snapshot().status,'unconnected');assert.equal(stale.snapshot().records.length,0);});
test('actual license render uses PK for presentation only: XP, grade and earned achievements stay identical',async()=>{
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),c=vm.createContext({window:{},console,setTimeout:()=>{}});
 for(const f of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+f+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8,esc:String});
 const names=['hunterBuildAnalysis','hunterLicenseOverviewHtml','hunterPeriodSummary','hunterModeLabel','hunterBattleFiltersHtml','hunterEnchantmentSummaryHtml','renderPlayerStatsTab'];
 for(const name of names){const a=core.indexOf('function '+name+'('),b=core.indexOf('\nfunction ',a+1);vm.runInContext(core.slice(a,b),c);}
 const formal=Array.from({length:10},(_,i)=>({eventCode:'formal',matchId:'m'+i,completedAt:1700000000100+i,scoringVersion:'bxh-4pt-v1',analyzable:true,isWin:true,scoreFor:4,scoreAgainst:1,roundsPerspective:[{type:'burst',points:2,perspective:'for'},{type:'burst',points:2,perspective:'for'},{type:'spin',points:1,perspective:'against'}]}));
 Object.assign(c,{hunterProfileCache:{records:formal,skipped:[]},hunterProfileLoading:false,hunterProfileError:null,playerStatsSubTab:'overview',playerDerivedId:()=> 'TEST',effectiveGameId:()=>'',myLadderProfileCache:{},myLadderProfileLoading:false,ladderPublicLoaded:true,ladderPublicLoading:false,ladderPublicData:{players:[],control:{}},firebaseUser:null,rankLadderRows:()=>[],ladderDisplayTier:()=> 'E',hunterOverviewPeriod:'career',hunterSeasonStartMs:()=>0,hunterRecordEventKey:c.window.BXHDomainUtils.hunterRecordEventKey,hunterClashEntry:{visible:()=>true}});
 const pk=formal.map(r=>({...r,eventCode:'pk:arena-internal:room',sourceType:'hunter-clash',scoringVersion:adapter.VERSION,isWin:false,scoreFor:1,scoreAgainst:4,roundsPerspective:[{type:'spin',points:1,perspective:'for'},{type:'burst',points:2,perspective:'against'},{type:'burst',points:2,perspective:'against'}]}));
 c.hunterRecordsForPeriod=()=>c.hunterFilterByMode(c.window.BXHArenaPK?.displayRecords(formal)||formal,c.hunterBattleFilter);
 c.hunterBattleFilter='all';const before=c.renderPlayerStatsTab({displayName:'黑爸'}),xp=before.match(/<strong>(\d+) XP<\/strong>/)[1];c.hunterProfileCache.achievementCore={unlocked:['existing-award'],metrics:{matches:10}};const achievements=JSON.stringify(c.hunterProfileCache.achievementCore);
 c.window.BXHArenaPK={displayRecords:rows=>[...rows,...pk],statusHtml:()=>'<p>PK 已核對</p>',state:()=>({status:'ready'})};
 const after=c.renderPlayerStatsTab({displayName:'黑爸'});assert.match(after,/20 場/);assert.equal(after.match(/<strong>(\d+) XP<\/strong>/)[1],xp);assert.match(after,/A 級獵人/);assert.match(before,/A 級獵人/);assert.equal(JSON.stringify(c.hunterProfileCache.achievementCore),achievements);assert.equal(c.hunterBuildAnalysis(pk).overall,null);assert.equal(c.hunterBuildAnalysis(pk).validRounds,30);
});

test('PK App Check shares the ARENA app, deduplicates initialization and retries failed loading',async()=>{
 const source=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
 const start=source.indexOf('  async function ensureHunterClashAppCheck(){'),end=source.indexOf('\n  let cloudEnabled',start);
 const helper=source.slice(start,end).replace(/await import\(`https:\/\/www\.gstatic\.com\/firebasejs\/\$\{FIREBASE_SDK_VERSION\}\/firebase-app-check\.js`\)/,'await load()');
 const app={},calls=[];let attempts=0,fail=true;
 const mod={ReCaptchaEnterpriseProvider:class{constructor(key){this.key=key;}},initializeAppCheck:(a,options)=>{calls.push({a,options});return {app:a};},getToken:async(h,force)=>{assert.equal(h.app,app);assert.equal(force,false);return {token:'verified'};}};
 const c=vm.createContext({load:async()=>{attempts++;if(fail)throw Error('offline');return mod;},firebaseAppHandle:app,ARENA_APP_CHECK_SITE_KEY:'public-key',appCheckHandle:null,appCheckModule:null,appCheckInitPromise:null});
 vm.runInContext(helper,c);await assert.rejects(c.ensureHunterClashAppCheck(),/offline/);fail=false;
 await Promise.all([c.ensureHunterClashAppCheck(),c.ensureHunterClashAppCheck()]);
 assert.equal(attempts,2);assert.equal(calls.length,1);assert.equal(calls[0].a,app);assert.equal(calls[0].options.isTokenAutoRefreshEnabled,true);assert.equal(calls[0].options.provider.key,'public-key');
});


test('unfinished recovery hints survive a closed tab, isolate accounts and clear persistent hints on completion',async()=>{
 const {createRecoveryStore}=await import('../hunter-clash/arena/recovery.mjs');
 const memoryStorage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
 const session=memoryStorage(),persistent=memoryStorage();let recovery=createRecoveryStore({session,persistent});
 recovery.remember('a',{challengeId:'pk_room',status:'final_pending'});
 assert.equal(recovery.id('b'),null);
 recovery=createRecoveryStore({session:memoryStorage(),persistent});assert.equal(recovery.id('a'),'pk_room');
 recovery.remember('a',{challengeId:'pk_room',status:'completed'});
 assert.equal(createRecoveryStore({session:memoryStorage(),persistent}).id('a'),null);
 assert.equal(recovery.id('a'),null); // The displayed result lives in the controller snapshot, not a recovery hint.
 recovery.clear('a');assert.equal(recovery.id('a'),null);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.doesNotThrow(()=>createRecoveryStore({session,persistent:blocked}).remember('a',{challengeId:'pk_room',status:'final_pending'}));
 assert.equal(createRecoveryStore({session,persistent:blocked}).id('a'),'pk_room');
});

test('ordinary players outside old allowlist complete and save PK; invalid profiles stay blocked',async()=>{
 const f=fixture();f.data.get('systemSettings/hunterClash').allowedUids=[];
 await finish(f,await score(f,await start(f)));
 assert.equal((await f.call('a','getMyHistory')).history.total,1);
 for(const patch of [{active:false},{isTestAccount:true},{role:'guest'},{accountStatus:'frozen'},{accountStatus:'disabled'},{accountStatus:'deleted'}]){
   const old={...f.data.get('users/c')};Object.assign(f.data.get('users/c'),patch);
   await assert.rejects(f.call('c','createChallenge'),/account-unavailable/);f.data.set('users/c',old);
 }
});

test('recovery clears unavailable rooms only after definitive lookup and retains pending operations',async()=>{
 const {createRecoveryStore}=await import('../hunter-clash/arena/recovery.mjs');
 const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const recovery=createRecoveryStore({session:storage,persistent:storage});
 recovery.remember('a',{challengeId:'pk_old',status:'final_pending'});
 for(const [error,pending] of [[Error('offline'),false],[Object.assign(Error('unauthenticated'),{definitive:true}),false],[Object.assign(Error('challenge-unavailable'),{definitive:true}),true]]){
  assert.equal(recovery.clearUnavailable('a',error,{pending}),false);assert.equal(recovery.id('a'),'pk_old');
 }
 assert.equal(recovery.clearUnavailable('a',Object.assign(Error('challenge-unavailable'),{definitive:true})),true);
 assert.equal(recovery.id('a'),null);
});

test('recovery return persists dismissal without removing the room bookmark',async()=>{
 const {createRecoveryStore}=await import('../hunter-clash/arena/recovery.mjs');
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let recovery=createRecoveryStore({session:storage,persistent:storage});
 recovery.remember('a',{challengeId:'pk_room',status:'final_pending'});recovery.dismiss('a');
 recovery=createRecoveryStore({session:storage,persistent:storage});
 assert.equal(recovery.dismissed('a'),true);assert.equal(recovery.dismissed('b'),false);assert.equal(recovery.id('a'),'pk_room');
 assert.equal(recovery.clearUnavailable('a',Object.assign(Error('challenge-unavailable functions/failed-precondition'),{definitive:true})),true);
 recovery.clear('a');assert.equal(recovery.dismissed('a'),false);
});
test('recovery read timeout releases buttons and ignores a late server response',async()=>{
 const {createController}=await import('../hunter-clash/arena/controller.mjs');
 let resolve;const client=createController({readTimeoutMs:10,transport:()=>new Promise(r=>{resolve=r;})});
 client.setSession('a');await assert.rejects(client.read('pk_room'),/read-timeout/);
 assert.equal(client.state().busy,false);resolve({challenge:{challengeId:'pk_room',revision:1}});
 await new Promise(r=>setTimeout(r,0));assert.equal(client.state().snapshot,null);client.dispose();
});
