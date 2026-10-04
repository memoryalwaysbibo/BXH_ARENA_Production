const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('official single elimination enforces bronze before championship final', async ({ page }) => {
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
  const email=`admin.${run}@bxh-e2e.test`;
  const secret=crypto.randomUUID().replaceAll('-','')+'A9!';

  const response=await page.goto('/?bxh_e2e=1',{waitUntil:'domcontentloaded'});
  expect(response?.headers()['x-bxh-e2e-emulator']).toBe('1');

  // Admin bootstrap queries the Auth/Firestore emulators immediately after the
  // role click, so wait for the injected cloud runtime before starting it.
  await page.waitForFunction(
    () => window.cloudAuth && typeof window.cloudAuth.isReady === 'function' && window.cloudAuth.isReady(),
    null,
    { timeout: 90000 }
  );
  await page.locator('[data-action="select-role-admin"]').click();
  await expect(page.locator('#setup-displayname')).toBeVisible({timeout:30000});
  await page.locator('#setup-displayname').fill('BOT SUPER ADMIN');
  await page.locator('#setup-username').fill(email);
  await page.locator('#setup-password').fill(secret);
  await page.locator('#setup-password2').fill(secret);
  await page.locator('[data-action="admin-setup-submit"]').click();

  // createSuperAdmin signs the account into the Auth emulator. Depending on
  // observer timing, ARENA may already enter admin mode or briefly show login.
  await page.waitForFunction(()=>{
    return !!document.querySelector('[data-action="cloud-admin-new-tournament"]') ||
           !!document.querySelector('#auth-username');
  },null,{timeout:30000});

  if(await page.locator('#auth-username').isVisible().catch(()=>false)){
    await page.locator('#auth-username').fill(email);
    await page.locator('#auth-password').fill(secret);
    await page.locator('[data-action="admin-login-submit"]').click();
  }

  await page.waitForFunction(()=>{
    return !!document.querySelector('[data-action="cloud-admin-new-tournament"]') ||
      !!document.querySelector('[data-action="select-role-admin"]');
  },null,{timeout:60000});
  if(await page.locator('[data-action="select-role-admin"]').isVisible().catch(()=>false)){
    await page.locator('[data-action="select-role-admin"]').click();
    if(await page.locator('#auth-username').isVisible().catch(()=>false)){
      await page.locator('#auth-username').fill(email);
      await page.locator('#auth-password').fill(secret);
      await page.locator('[data-action="admin-login-submit"]').click();
    }
  }
  await expect(page.locator('[data-action="cloud-admin-new-tournament"]').first()).toBeVisible({timeout:60000});
  await page.locator('[data-action="cloud-admin-new-tournament"]').first().click();

  const genericConfirm=page.locator('[data-action="modal-confirm"]');
  if(await genericConfirm.isVisible().catch(()=>false)) await genericConfirm.click();

  await expect(page.locator('#f-bronze')).toBeVisible({timeout:20000});
  await page.locator('#f-name').fill('E2E 季殿順序驗證');
  await page.locator('#f-bronze').check();
  await page.locator('[data-action="save-meta"]').click();

  await page.locator('[data-action="switch-tab"][data-tab="people"]').click();
  await page.locator('[data-action="people-section"][data-section="tools"]').click();
  await page.locator('#quick-add-textarea').fill('Final A\nFinal B\nFinal C\nFinal D');
  await page.locator('[data-action="quick-add-players"]').click();

  await page.locator('[data-action="people-section"][data-section="confirmed"]').click();
  await expect(page.locator('.people-roster-table .people-col-name')).toHaveCount(4);

  await page.locator('[data-action="people-section"][data-section="bracket"]').click();
  await page.locator('[data-action="draw-bracket"]').click();
  await expect(page.locator('[data-action="start-tournament"]')).toBeVisible({timeout:15000});
  await page.locator('[data-action="start-tournament"]').click();
  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({timeout:15000});
  await page.locator('[data-action="modal-confirm"]').click();

  await page.locator('[data-action="switch-tab"][data-tab="referee"]').click();

  async function winCurrentA(expectedCompleted){
    const extreme=page.locator('[data-action="score"][data-side="A"][data-type="extreme"]:not([disabled])').first();
    await expect(extreme).toBeVisible({timeout:30000});
    await extreme.click();

    await page.waitForFunction(()=>{
      const active=[...document.querySelectorAll('.court-card.referee-workstation')]
        .find(card=>card.querySelector('[data-action="score"]:not([disabled])'));
      if(!active)return false;
      return [...active.querySelectorAll('.side-score')].some(x=>x.textContent.trim()==='3');
    },null,{timeout:20000});

    await page.evaluate(async()=>{
      if(typeof flushStationMatchMutations==='function')await flushStationMatchMutations();
    });

    const spin=page.locator('[data-action="score"][data-side="A"][data-type="spin"]:not([disabled])').first();
    await expect(spin).toBeVisible({timeout:20000});
    await spin.click({force:true});

    await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({timeout:15000});
    await page.locator('[data-action="modal-confirm"]').click();

    await page.waitForFunction(count=>{
      return state.matches.filter(m=>m&&!m.isBye&&m.completed).length>=count;
    },expectedCompleted,{timeout:30000});
  }

  // Two semi-finals.
  await winCurrentA(1);
  await winCurrentA(2);

  const gated=await page.evaluate(()=>{
    const se=state.matches.filter(m=>m&&m.bracket==='SE'&&!m.isBye);
    const finalRound=Math.max(...se.map(m=>Number(m.round)||0));
    const final=se.find(m=>Number(m.round||0)===finalRound);
    const bronze=state.matches.find(m=>m&&m.bracket==='BZ');
    const court=state.courtAssignments&&state.courtAssignments.court1;
    return {
      bronzeId:bronze&&bronze.id,
      bronzeStatus:bronze&&bronze.status,
      bronzeCompleted:!!(bronze&&bronze.completed),
      finalId:final&&final.id,
      finalStatus:final&&final.status,
      finalStartedAt:final&&final.startedAt,
      currentMatchId:court&&court.currentMatchId,
      bronzeSeq:bronze&&bronze.seq,
      finalSeq:final&&final.seq
    };
  });

  expect(gated.bronzeId).toBeTruthy();
  expect(gated.finalId).toBeTruthy();
  expect(gated.currentMatchId).toBe(gated.bronzeId);
  expect(gated.bronzeCompleted).toBe(false);
  expect(['pending','ready','in_progress']).toContain(gated.bronzeStatus);
  expect(gated.finalStatus).toBe('pending');
  expect(gated.finalStartedAt).toBeFalsy();
  expect(Number(gated.bronzeSeq)).toBeLessThan(Number(gated.finalSeq));
  await expect(page.locator('.ref-workstation-meta small').first()).toContainText('季殿',{timeout:20000});

  // Bronze / fourth-place match must finish before final is released.
  await winCurrentA(3);

  const released=await page.evaluate(()=>{
    const se=state.matches.filter(m=>m&&m.bracket==='SE'&&!m.isBye);
    const finalRound=Math.max(...se.map(m=>Number(m.round)||0));
    const final=se.find(m=>Number(m.round||0)===finalRound);
    const bronze=state.matches.find(m=>m&&m.bracket==='BZ');
    const court=state.courtAssignments&&state.courtAssignments.court1;
    return {
      bronzeCompleted:!!bronze.completed,
      thirdId:state.thirdId,
      fourthId:state.fourthId,
      finalId:final.id,
      finalStatus:final.status,
      currentMatchId:court&&court.currentMatchId
    };
  });

  expect(released.bronzeCompleted).toBe(true);
  expect(released.thirdId).toBeTruthy();
  expect(released.fourthId).toBeTruthy();
  expect(released.currentMatchId).toBe(released.finalId);
  expect(['ready','in_progress']).toContain(released.finalStatus);
  await expect(page.locator('.ref-workstation-meta small').first()).toContainText('冠亞',{timeout:20000});

  // Championship final.
  await winCurrentA(4);

  await page.waitForFunction(()=>{
    return !!state.championId && !!state.runnerUpId && !!state.thirdId && !!state.fourthId &&
      state.archiveStatus==='completed';
  },null,{timeout:45000});

  const completed=await page.evaluate(()=>{
    const se=state.matches.filter(m=>m&&m.bracket==='SE'&&!m.isBye);
    const finalRound=Math.max(...se.map(m=>Number(m.round)||0));
    const final=se.find(m=>Number(m.round||0)===finalRound);
    const bronze=state.matches.find(m=>m&&m.bracket==='BZ');
    const name=id=>(state.players||[]).find(p=>p.id===id)?.name||'';
    return {
      championId:state.championId,
      runnerUpId:state.runnerUpId,
      thirdId:state.thirdId,
      fourthId:state.fourthId,
      championName:name(state.championId),
      runnerUpName:name(state.runnerUpId),
      thirdName:name(state.thirdId),
      fourthName:name(state.fourthId),
      finalId:final?.id||null,
      bronzeId:bronze?.id||null,
      archiveStatus:state.archiveStatus,
      completedMatches:state.matches.filter(m=>m&&!m.isBye&&m.completed).length,
      totalMatches:state.matches.filter(m=>m&&!m.isBye).length
    };
  });

  expect(completed.championId).toBeTruthy();
  expect(completed.runnerUpId).toBeTruthy();
  expect(completed.thirdId).toBeTruthy();
  expect(completed.fourthId).toBeTruthy();
  expect(completed.completedMatches).toBe(4);
  expect(completed.totalMatches).toBe(4);
  expect(completed.archiveStatus).toBe('completed');

  // Data and rendered bracket must agree on all four placements.
  const celebrationBracket=page.locator('[data-action="celeb-view-bracket"]').first();
  if(await celebrationBracket.isVisible().catch(()=>false)) await celebrationBracket.click();
  else await page.locator('[data-action="switch-tab"][data-tab="bracket"]').first().click();
  // Scope to the live bracket only. The hidden print bracket intentionally
  // mirrors the same match ids and must not make the locator ambiguous.
  const liveBracket=page.locator('#se-bracket-cols');
  await expect(liveBracket).toBeVisible({timeout:20000});
  const finalBox=liveBracket.locator(`.match-box[data-id="${completed.finalId}"]`);
  const bronzeBox=liveBracket.locator(`.match-box[data-id="${completed.bronzeId}"]`);
  await expect(finalBox).toBeVisible({timeout:20000});
  await expect(bronzeBox).toBeVisible({timeout:20000});
  await expect(finalBox.locator('.mb-row.winner')).toContainText(completed.championName);
  await expect(finalBox).toContainText(completed.runnerUpName);
  await expect(bronzeBox.locator('.mb-row.winner')).toContainText(completed.thirdName);
  await expect(bronzeBox).toContainText(completed.fourthName);

  expect(externalFirebaseRequests).toEqual([]);
});
