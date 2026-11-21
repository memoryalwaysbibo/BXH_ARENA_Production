'use strict';

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');
const { attachWireObserver } = require('./lobby-idle-wire.cjs');

const PROJECT = 'demo-bxh-arena-e2e';
const LAB_BRANCH = 'lab/r1-home-websdk-wire-300-20261121';
const PATH = 'projects/' + PROJECT + '/databases/(default)/documents';
const EMULATOR = 'http://127.0.0.1:8080/v1/' + PATH;
const ORIGIN = 'http://127.0.0.1:4173';
const DURATION_MS = 300_000;
const COUNT = 20;
const F = '[data-action="player-switch-tab"]';
const sdkUrl = 'https://www.gstatic.com/firebasejs/10.13.0/';
const title = 'R1 synthetic measured lobby';
const summary = (key, value) => [key, typeof value === 'boolean' ? { booleanValue:value } :
  typeof value === 'number' ? { integerValue:String(value) } : { stringValue:value }];
const fields = x => Object.fromEntries(Object.entries(x).map(([k,v]) => summary(k,v)));

function filterRequest(url) {
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      ['4173','8080','9099','5001'].includes(url.port)) return 'loopback';
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/10.13.0/') &&
      url.pathname !== '/firebasejs/10.13.0/firebase-app-check.js') return 'sdk';
  return /(?:^|\.)(?:firestore|identitytoolkit|securetoken|firebaseappcheck|firebasestorage)\.googleapis\.com$|\.firebaseio\.com$|\.cloudfunctions\.net$/.test(url.hostname) ?
    'remote-firebase-blocked' : 'blocked';
}

async function makeContext(browser, control = false) {
  const context = await browser.newContext({ viewport:{width:1440,height:900}, serviceWorkers:'block' });
  const traffic = [];
  const wire = attachWireObserver(context, () => performance.now());
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const kind = filterRequest(url);
    const during = performance.now();
    if (kind === 'remote-firebase-blocked') traffic.push({during,kind});
    if (kind === 'loopback' && ['8080','9099','5001'].includes(url.port)) {
      // No URLs, authentication headers, payloads or user identifiers in output.
      traffic.push({during,kind:'emulator-' + url.port, method:req.method()});
    }
    return (kind === 'sdk' || kind === 'loopback') ? route.continue() : route.abort('blockedbyclient');
  });
  if (control) await context.addInitScript(() => { window.BXH_LOBBY_SKIP_HEALTHY_IDLE_POLL = false; });
  const page = await context.newPage();
  return {context,page,traffic,wire};
}

async function appEntry(page) {
  const res = await page.goto(ORIGIN + '/?bxh_e2e=1', {waitUntil:'domcontentloaded'});
  expect(res?.headers()['x-bxh-e2e-emulator']).toBe('1');
  await page.waitForFunction(() => window.cloudAuth?.isReady(), null, {timeout:90000});
  const project = await page.evaluate(async sdk => {
    const app = await import(sdk + 'firebase-app.js');
    return app.getApp().options.projectId;
  }, sdkUrl);
  expect(project).toBe(PROJECT);
  await page.locator('[data-action="select-role-player"]').click();
}

async function createPlayer(page, cred) {
  await appEntry(page);
  await page.locator('[data-action="player-goto-apply"]').click();
  const fields = {
    '#apply-realname':'R1 測試玩家', '#apply-email':cred.email, '#apply-password':cred.secret,
    '#apply-password2':cred.secret, '#apply-nickname':'R1-IDLE-AB', '#apply-phone':'0900000000',
  };
  for (const [selector,value] of Object.entries(fields)) await page.locator(selector).fill(value);
  await page.locator('#apply-agree').check();
  await page.locator('[data-action="player-apply-submit"]').click();
  await expect(page.locator('.player-shell')).toBeVisible({timeout:30000});
}

async function signInAndStage(page, cred, control) {
  await appEntry(page);
  await page.locator('[data-action="player-goto-login"]').first().click();
  await page.locator('#player-login-email').fill(cred.email);
  await page.locator('#player-login-password').fill(cred.secret);
  await page.locator('[data-action="player-email-signin"]').click();
  await expect(page.locator('.player-shell')).toBeVisible({timeout:30000});
  await page.locator(F+'[data-tab="host"]').first().click();
  await expect(page.locator('.community-host-hero')).toBeVisible({timeout:20000});
  return page.evaluate(async ({sdk,project,control}) => {
    const [apps,auth] = await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-auth.js')]);
    const app = apps.getApp(), current=auth.getAuth(app).currentUser;
    if (location.origin !== 'http://127.0.0.1:4173' || app.options.projectId !== project || !current ||
        (window.BXH_LOBBY_SKIP_HEALTHY_IDLE_POLL === false) !== control) throw new Error('unexpected A/B precondition');
    const cloud = window.cloudSync;
    const calls=[],watch=[],signals=[];
    const query=cloud.queryPublicTournaments, subscribe=cloud.subscribePublicTournaments;
    cloud.queryPublicTournaments = async function(...args) {
      const row={start:performance.now()};
      calls.push(row);
      try {
        const x=await query.apply(this,args);
        Object.assign(row,{end:performance.now(),ok:x?.ok===true,rawCount:x?.rawCount,fromCache:x?.fromCache,hasPendingWrites:x?.hasPendingWrites});
        return x;
      } catch(e) {
        row.end=performance.now(); row.ok=false; throw e;
      }
    };
    cloud.subscribePublicTournaments = function(callback) {
      return subscribe.call(this,x => {
        callback(x);
        watch.push({at:performance.now(),ok:x?.ok===true,fromCache:x?.fromCache,
          hasPendingWrites:x?.hasPendingWrites,requiresLifecycleReconcile:x?.requiresLifecycleReconcile,
          items:(x?.items || []).map(row=>[row.code,row.confirmedCount]).sort()});
      });
    };
    for(const name of ['focus','blur','pagehide','pageshow']) {
      window.addEventListener(name,()=>signals.push({at:performance.now(),name}),true);
    }
    document.addEventListener('visibilitychange',()=>signals.push({at:performance.now(),name:'visibility-'+document.visibilityState}),true);
    window.__idle300={calls,watch,signals};
    return current.uid;
  }, {sdk:sdkUrl,project:PROJECT,control});
}

function assertIsolatedHarness(env=process.env) {
  if (env.GCLOUD_PROJECT!==PROJECT || env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080' ||
      env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099') throw new Error('expected exact local demo Auth/Firestore emulators');
  if (env.GITHUB_ACTIONS==='true' && !(
    (env.GITHUB_EVENT_NAME==='pull_request' && env.GITHUB_HEAD_REF===LAB_BRANCH && env.GITHUB_BASE_REF==='main') ||
    (env.GITHUB_EVENT_NAME==='workflow_dispatch' && env.GITHUB_REF==='refs/heads/'+LAB_BRANCH)
  )) throw new Error('benchmark accepts only the dedicated non-main lab ref');
}

async function readNormalE2EResidual(request) {
  const res=await request.post(EMULATOR+':runQuery',{
    headers:{Authorization:'Bearer owner'}, maxRedirects:0,
    data:{structuredQuery:{from:[{collectionId:'publicTournaments'}],where:{
      fieldFilter:{field:{fieldPath:'visibility'},op:'EQUAL',value:{stringValue:'public'}}
    },limit:2}},
  });
  expect(res.status(),'loopback baseline query').toBe(200);
  const rows=(await res.json()).flatMap(x=>x.document?[x.document]:[]);
  expect(rows.length,'fresh standalone emulator (0) or unchanged preceding normal E2E (1)').toBeLessThanOrEqual(1);
  return rows.map(row=>{
    const key=row.name?.split('/').at(-1);
    expect(key).toMatch(/^BXH-[A-Z0-9]{6}$/);
    expect(row.name).toBe(PATH+'/publicTournaments/'+key);
    expect(row.fields).toMatchObject({eventAuthority:{stringValue:'community'},communityQuickRegistration:{booleanValue:true},
      confirmedCount:{integerValue:'0'},visibility:{stringValue:'public'}});
    return [key,0];
  });
}

async function commit(request, writes) {
  const res=await request.post(EMULATOR+':commit',{
    headers:{Authorization:'Bearer owner'}, // Firestore Emulator admin fixture only.
    maxRedirects:0,data:{writes},
  });
  expect(res.status(),'isolated fixture write must succeed').toBe(200);
}

const browserView = page => page.evaluate(() => ({
  // Browser performance.now timestamps each full query and visibility signal;
  // the independent host monotonic clock bounds the shared measurement window.
  at:performance.now(), visibility:document.visibilityState, focus:document.hasFocus(),
  home:isTournamentLobbyVisible(), timer:publicTournamentsReconcileTimer!==null,
  skip:shouldSkipLobbyIdlePoll(), ...window.__idle300,
}));

async function waitTrusted(page, sameRows) {
  await page.waitForFunction(expected => {
    const x = window.__idle300;
    const watch=x?.watch.at(-1);
    return !!watch && watch.ok && watch.fromCache===false && watch.hasPendingWrites===false &&
      watch.requiresLifecycleReconcile===false && JSON.stringify(watch.items)===JSON.stringify(expected) &&
      x.calls.every(q=>q.end!==undefined) && isTournamentLobbyVisible();
  },sameRows,{timeout:20000});
}

function assertForeground(a) {
  expect(a.visibility).toBe('visible');
  expect(a.focus).toBe(true);
  expect(a.home).toBe(true);
}

function measured(browser, first, last, hostStart, hostEnd, expectedDocs) {
  const elapsed=last.at-first.at;
  expect(elapsed).toBeGreaterThanOrEqual(DURATION_MS);
  const calls=last.calls.filter(q=>q.start>=first.at && q.start<last.at);
  for(const call of calls) {
    expect(call).toMatchObject({ok:true,rawCount:expectedDocs,fromCache:false,hasPendingWrites:false});
    expect(call.end).toBeLessThanOrEqual(last.at);
  }
  expect(last.signals.filter(s=>s.at>=first.at && s.at<last.at)).toEqual([]);
  const unhealthy=last.watch.filter(s=>s.at>=first.at && s.at<last.at &&
    (!s.ok || s.fromCache!==false || s.hasPendingWrites!==false || s.requiresLifecycleReconcile!==false));
  expect(unhealthy).toEqual([]);
  const report={elapsedMs:Math.round(elapsed),fullQueryCalls:calls.length,serverQueryDocs:calls.reduce((m,x)=>m+x.rawCount,0),
    queryStartsMs:calls.map(x=>Math.round(x.start-first.at)),
    watchCallbacks:last.watch.filter(x=>x.at>=first.at&&x.at<last.at).length,
    emulatorRequestTotals:{}};
  for(const {kind} of browser.traffic.filter(x=>x.during>=hostStart&&x.during<hostEnd)) {
    report.emulatorRequestTotals[kind]=(report.emulatorRequestTotals[kind]||0)+1;
  }
  return report;
}

async function openAndAssertCard(page, code) {
  const toggle=page.locator('[data-lobby-section="registration"] > .lobby-collapse-toggle');
  if(await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
  const card=page.locator('[data-lobby-code="'+code+'"]');
  if(!await card.evaluate(el=>el.open)) await card.locator(':scope > summary').click();
  await expect(card.locator('.lobby-detail-grid').getByText('名額｜2 / 16',{exact:true})).toBeVisible();
}

test('homepage R1: same-commit trusted Web SDK idle A/B for a real 300 seconds', async ({playwright,request}, testInfo) => {
  assertIsolatedHarness();
  const prior=await readNormalE2EResidual(request);
  // Separate headless Chrome processes avoid a single browser electing one
  // focused page across its two contexts. Both must independently prove focus.
  const [controlBrowser,candidateBrowser]=await Promise.all([playwright.chromium.launch(),playwright.chromium.launch()]);
  const contexts=[];
  const run=randomUUID().slice(0,8).toUpperCase();
  const cred={email:'idle300.'+run.toLowerCase()+'@bxh-e2e.test',secret:randomUUID()+'A9!'};
  const codes=Array.from({length:COUNT},(_,i)=>'R1-IDLE-'+run+'-'+String(i).padStart(2,'0'));
  const name=code=>PATH+'/publicTournaments/'+code;
  const now=Date.now();
  const before=[...prior,...codes.map(code=>[code,1])].sort();
  let seeded=false;
  try {
    const bootstrap=await makeContext(controlBrowser);
    contexts.push(bootstrap);
    await createPlayer(bootstrap.page,cred);
    await bootstrap.context.close();
    await commit(request,codes.map(code=>({update:{name:name(code),fields:fields({
      visibility:'public',eventAuthority:'official',ownerUid:'synthetic-unrelated-host',
      name:title,publishedAt:now,tournamentPhase:'waiting',registrationVisibility:'public',
      registrationStatus:'open',registrationEnabled:true,
      registrationOpenAt:now-3_600_000,registrationCloseAt:now+3_600_000,
      capacity:16,confirmedCount:1,
      bracketView:JSON.stringify({meta:{name:title,eventAuthority:'official'},players:[],matches:[],archiveStatus:'ongoing'}),
    })}})));
    seeded=true;
    const [control,candidate]=await Promise.all([makeContext(controlBrowser,true),makeContext(candidateBrowser)]);
    contexts.push(control,candidate);
    const pair=[control,candidate];
    const ids=await Promise.all(pair.map((v,i)=>signInAndStage(v.page,cred,i===0)));
    expect(ids[0]).toBe(ids[1]);
    await Promise.all(pair.map(v=>v.page.bringToFront()));
    const entry=performance.now();
    await Promise.all(pair.map(v=>v.page.locator(F+'[data-tab="home"]').first().click()));
    await Promise.all(pair.map(v=>waitTrusted(v.page,before)));
    for(const v of pair) await expect(v.page.locator('[data-lobby-code="'+codes[0]+'"]')).toBeAttached();
    const begin=await Promise.all(pair.map(v=>browserView(v.page)));
    begin.forEach(assertForeground);
    expect(performance.now()-entry).toBeLessThan(25_000); // shorter than the 30s margin after three 90s slots
    expect(begin[0]).toMatchObject({timer:true,skip:false});
    expect(begin[1]).toMatchObject({timer:false,skip:true});

    const hostStart=performance.now();
    console.log(JSON.stringify({stage:'trusted-start',fixtureRooms:COUNT,realSeconds:300,isolatedProject:PROJECT}));
    for(let i=0;i<10;i++) {
      const due=hostStart+(i+1)*(DURATION_MS/10);
      while(performance.now()<due) await sleep(Math.ceil(due-performance.now()));
      const samples=await Promise.all(pair.map(v=>browserView(v.page)));
      samples.forEach(assertForeground);
      expect(samples[1]).toMatchObject({timer:false,skip:true});
    }
    const end=await Promise.all(pair.map(v=>browserView(v.page)));
    const hostEnd=performance.now();
    expect(hostEnd-hostStart).toBeGreaterThanOrEqual(DURATION_MS);
    expect(hostEnd-hostStart).toBeLessThan(DURATION_MS+3_000);
    end.forEach(assertForeground);
    expect(end[0]).toMatchObject({timer:true,skip:false});
    expect(end[1]).toMatchObject({timer:false,skip:true});
    expect(Math.abs((end[0].at-begin[0].at)-(end[1].at-begin[1].at))).toBeLessThan(1_000);
    const [controlWire,candidateWire]=await Promise.all(pair.map(v=>v.wire.report(hostStart,hostStart+DURATION_MS,sleep)));
    const transport={windowMs:DURATION_MS,control:controlWire,candidate:candidateWire,
      meaning:'Listen target commands + encoded HTTP sizes for completed loopback requests wholly in the window; may include multiplexed non-lobby targets, omit crossing/incomplete streams, and never establish billed reads'};
    await testInfo.attach('homepage-r1-wire300.json',{body:JSON.stringify(transport,null,2),contentType:'application/json'});

    const [controlResult,candidateResult]=pair.map((v,i)=>measured(v,begin[i],end[i],hostStart,hostEnd,before.length));
    expect(controlResult.fullQueryCalls).toBe(3);
    expect(candidateResult.fullQueryCalls).toBe(0);
    expect(controlResult.serverQueryDocs).toBe(before.length*3);
    expect(candidateResult.serverQueryDocs).toBe(0);

    const after=before.map(([code,n])=>[code,n+(code===codes[0]?1:0)]);
    await commit(request,[{update:{name:name(codes[0]),fields:fields({confirmedCount:2})},
      updateMask:{fieldPaths:['confirmedCount']}}]);
    await Promise.all(pair.map(v=>waitTrusted(v.page,after)));
    await Promise.all(pair.map(v=>openAndAssertCard(v.page,codes[0])));
    expect(pair.flatMap(v=>v.traffic.filter(x=>x.kind==='remote-firebase-blocked'))).toEqual([]);
    const report={project:PROJECT,fixtureRooms:COUNT,previousSyntheticRooms:prior.length,hostElapsedMs:Math.round(hostEnd-hostStart),
      control:controlResult,candidate:candidateResult,bothUpdate:2,transport,
      meaning:'application full-query calls / server receipts only; not backend-billed reads or raw wire requests'};
    console.log(JSON.stringify(report));
    await testInfo.attach('homepage-r1-local-ab300.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
  } finally {
    await Promise.allSettled(contexts.map(v=>v.context.close()));
    await Promise.allSettled([controlBrowser.close(),candidateBrowser.close()]);
    if(seeded) await commit(request,codes.map(code=>({delete:name(code)})));
  }
});
