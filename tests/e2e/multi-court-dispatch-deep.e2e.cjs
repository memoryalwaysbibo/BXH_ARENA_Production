const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('two courts preserve independent work and queue a skipped match onto a busy court', async ({ page }) => {

  async function dumpBracketDiagnostics(label){
    const diag=await page.evaluate((diagnosticLabel)=>({
      label:diagnosticLabel,
      bracketSize:state?.bracketSize,
      playersLength:state?.players?.length,
      registrationEnabled:state?.meta?.registrationEnabled,
      checkinRequired:state?.meta?.checkinRequired,
      entrySelection:state?.entrySelection,
      eligiblePlayersLength:typeof eligiblePlayers==='function'?eligiblePlayers().length:null,
      entryRosterValid:typeof entryRosterValid==='function'?entryRosterValid():null,
      cloudCode:state?.cloudCode,
      currentRole:typeof currentRole!=='undefined'?currentRole:null,
      userRole:typeof userProfile!=='undefined'?userProfile?.role:null,
      isTestAccount:typeof userProfile!=='undefined'?userProfile?.isTestAccount:null,
      activeMode:typeof activeMode!=='undefined'?activeMode:null,
      modalTitle:document.querySelector('.modal-title')?.textContent?.trim()||null,
      modalMessage:document.querySelector('.modal-message')?.textContent?.trim()||null,
      visibleText:[...document.querySelectorAll('.toast,.error,.alert')].filter(x=>x.offsetParent!==null).map(x=>x.textContent?.trim()).filter(Boolean).slice(0,10)
    }),label);
    console.log('[P2P bracket diagnostics]',JSON.stringify(diag));
    return diag;
  }

  const externalFirebaseRequests=[];

  await page.route('**/*', async route=>{
    const url=new URL(route.request().url());
    const host=url.hostname;
    const blocked=
      host==='firestore.googleapis.com' ||
      host==='identitytoolkit.googleapis.com' ||
      host==='securetoken.googleapis.com' ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.cloudfunctions.net');
    if(blocked){
      externalFirebaseRequests.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const run=Date.now().toString(36);
  const email=`multicourt.${run}@bxh-e2e.test`;
  const secret=crypto.randomUUID().replaceAll('-','')+'A9!';

  const response=await page.goto('/?bxh_e2e=1',{waitUntil:'domcontentloaded'});
  expect(response?.headers()['x-bxh-e2e-emulator']).toBe('1');

  await page.locator('[data-action="select-role-player"]').click();
  await page.locator('[data-action="player-goto-apply"]').click();
  await page.locator('#apply-realname').fill('BOT 雙台測試');
  await page.locator('#apply-email').fill(email);
  await page.locator('#apply-password').fill(secret);
  await page.locator('#apply-password2').fill(secret);
  await page.locator('#apply-nickname').fill('BOT-MULTI');
  await page.locator('#apply-phone').fill('0900000000');
  await page.locator('#apply-agree').check();

  await page.waitForFunction(
    ()=>window.cloudAuth&&typeof window.cloudAuth.isReady==='function'&&window.cloudAuth.isReady(),
    null,{timeout:90000}
  );
  await page.locator('[data-action="player-apply-submit"]').click();
  await expect(page.locator('.player-shell')).toBeVisible({timeout:30000});

  await page.locator('[data-action="player-switch-tab"][data-tab="host"]').first().click();
  await page.locator('[data-action="community-create-open"]').click();
  await page.locator('#community-format').selectOption('single');
  await page.locator('[data-action="community-create-submit"]').click();
  await expect(page.locator('.community-room-notice')).toBeVisible({timeout:30000});

  // Expand the community room to two courts through the actual settings UI.
  await page.locator('[data-action="community-switch-room-tab"][data-tab="settings"]').click();
  await page.locator('#cset-stations').fill('2');
  await page.locator('[data-action="community-save-settings"]').click();
  await page.waitForFunction(()=>Number(state.meta?.stations)===2,null,{timeout:30000});

  // Host + three on-site players = four-player field.
  await page.locator('[data-action="community-switch-room-tab"][data-tab="people"]').click();
  await page.locator('[data-action="people-section"][data-section="tools"]').click();
  await page.locator('#quick-add-textarea').fill('Court A\nCourt B\nCourt C');
  await page.locator('[data-action="quick-add-players"]').click();

  await page.locator('[data-action="people-section"][data-section="confirmed"]').click();
  await expect(page.locator('.people-roster-table .people-col-name')).toHaveCount(4);

  await page.locator('[data-action="people-section"][data-section="bracket"]').click();
  await page.evaluate(()=>{
    window.__p2pActionProbe=[];
    document.addEventListener('click',e=>{
      const t=e.target&&e.target.closest?e.target.closest('[data-action]'):null;
      if(t) window.__p2pActionProbe.push({action:t.getAttribute('data-action'),time:Date.now(),defaultPrevented:e.defaultPrevented});
    },true);
  });

  await page.locator('[data-action="draw-bracket"]').click();
  const confirmDraw=page.locator('[data-action="modal-confirm"]');
  if(await confirmDraw.isVisible().catch(()=>false)) await confirmDraw.click();
  try {
    await page.waitForFunction(()=>Number(state.bracketSize)>0,null,{timeout:30000});
  } catch (error) {
    const actionProbe=await page.evaluate(()=>window.__p2pActionProbe||[]);
    console.log('[P2P action probe]',JSON.stringify(actionProbe));
    await dumpBracketDiagnostics('bracket-size-timeout');
    throw error;
  }
  await expect(page.locator('[data-action="start-tournament"]')).toBeVisible({timeout:30000});
  await page.locator('[data-action="start-tournament"]').click();
  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({timeout:15000});
  await page.locator('[data-action="modal-confirm"]').click();

  await page.locator('[data-action="community-switch-room-tab"][data-tab="referee"]').click();
  await expect(page.locator('#court-card-1')).toBeVisible({timeout:30000});
  await expect(page.locator('#court-card-2')).toBeVisible({timeout:30000});

  const initial=await page.evaluate(()=>({
    c1:state.courtAssignments?.court1?.currentMatchId||null,
    c2:state.courtAssignments?.court2?.currentMatchId||null
  }));
  expect(initial.c1).toBeTruthy();
  expect(initial.c2).toBeTruthy();
  expect(initial.c1).not.toBe(initial.c2);

  // Skip Court 1's current semifinal.
  await page.locator('#court-card-1 [data-action="skip-match"]').click();

  await page.waitForFunction(id=>{
    const m=state.matches.find(x=>x.id===id);
    return !!(m&&m.skippedAt&&!m.completed);
  },initial.c1,{timeout:30000});

  // The skipped match appears in the shared dispatch list. Queue it behind busy Court 2.
  const claimTo2=page.locator(`[data-action="claim-skipped-match"][data-id="${initial.c1}"][data-station="2"]`);
  await expect(claimTo2).toBeVisible({timeout:20000});
  await claimTo2.click();

  await page.waitForFunction(id=>{
    const m=state.matches.find(x=>x.id===id);
    return !!(m&&m.resumeQueuedAt&&Number(m.station)===2);
  },initial.c1,{timeout:30000});

  const queued=await page.evaluate(id=>({
    current:state.courtAssignments?.court2?.currentMatchId||null,
    next:state.courtAssignments?.court2?.nextMatchId||null,
    skipped:state.matches.find(x=>x.id===id)
  }),initial.c1);

  expect(queued.current).toBe(initial.c2);
  expect(queued.next).toBe(initial.c1);
  expect(queued.skipped.resumeQueuedAt).toBeTruthy();

  async function winCourt2Current(expectedCompleted){
    const card=page.locator('#court-card-2');
    const extreme=card.locator('[data-action="score"][data-side="A"][data-type="extreme"]:not([disabled])').first();
    await expect(extreme).toBeVisible({timeout:30000});
    await extreme.click();

    await page.evaluate(async()=>{
      if(typeof flushStationMatchMutations==='function')await flushStationMatchMutations();
    });

    const spin=card.locator('[data-action="score"][data-side="A"][data-type="spin"]:not([disabled])').first();
    await expect(spin).toBeVisible({timeout:20000});
    await spin.click({force:true});

    await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({timeout:15000});
    await page.locator('[data-action="modal-confirm"]').click();

    await page.waitForFunction(count=>
      state.matches.filter(m=>m&&!m.isBye&&m.completed).length>=count,
      expectedCompleted,{timeout:30000}
    );
    await page.evaluate(async()=>{
      if(typeof flushStationMatchMutations==='function')await flushStationMatchMutations();
      if(typeof flushCloudStateWrites==='function')await flushCloudStateWrites();
    });
  }

  await winCourt2Current(1);

  // After Court 2 finishes its own match, the claimed skipped match becomes its current match.
  await page.waitForFunction(id=>state.courtAssignments?.court2?.currentMatchId===id,initial.c1,{timeout:30000});
  const resumed=await page.evaluate(id=>{
    const m=state.matches.find(x=>x.id===id);
    return {status:m?.status,station:m?.station,current:state.courtAssignments?.court2?.currentMatchId};
  },initial.c1);

  expect(resumed.current).toBe(initial.c1);
  expect(resumed.station).toBe(2);
  expect(['ready','in_progress']).toContain(resumed.status);

  expect(externalFirebaseRequests).toEqual([]);
});
