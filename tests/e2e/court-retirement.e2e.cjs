const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('320-player safe retirement and cloud restoration', async ({ page }) => {
  page.setDefaultTimeout(30000);
  const externalFirebaseRequests=[];
  if(process.env.BXH_FIREBASE_SDK_CACHE) await page.route('https://www.gstatic.com/firebasejs/10.13.0/*',async route=>{
    const path=require('node:path').join(process.env.BXH_FIREBASE_SDK_CACHE,new URL(route.request().url()).pathname.split('/').pop());
    await route.fulfill({path,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
  });

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
    await route.fallback();
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
  await page.locator('#f-stations').fill('12');
  await page.locator('#f-date').fill('2026-11-21');
  await page.locator('#f-venue-name').fill('E2E 模擬場地');
  await page.locator('#f-venue-address').fill('E2E 模擬地址');
  await page.locator('[data-action="save-meta"]').click();


  await page.locator('[data-action="switch-tab"][data-tab="people"]').click();
  await page.locator('[data-action="people-section"][data-section="tools"]').click();
  await page.locator('#quick-add-textarea').fill(Array.from({length:320},(_,i)=>'BOT '+String(i+1).padStart(3,'0')).join('\n'));
  await page.locator('[data-action="quick-add-players"]').click();

  await page.locator('[data-action="people-section"][data-section="confirmed"]').click();
  await expect(page.locator('.people-roster-table .people-col-name')).toHaveCount(320);

  await page.locator('[data-action="switch-tab"][data-tab="settings"]').click();
  await page.locator('[data-action="open-registration-publish-preview"]').first().click();
  await page.locator('[data-action="modal-confirm"]').click();
  await page.waitForFunction(()=>!!state.cloudCode,null,{timeout:30000});
  console.log('PUBLISHED',await page.evaluate(()=>state.cloudCode));
  await page.locator('[data-action="switch-tab"][data-tab="people"]').click();
  await page.locator('[data-action="people-section"][data-section="bracket"]').click();
  await page.locator('[data-action="draw-bracket"]').click();
  await expect(page.locator('[data-action="start-tournament"]')).toBeVisible({timeout:15000});
  await page.locator('[data-action="start-tournament"]').click();
  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({timeout:15000});
  await page.locator('[data-action="modal-confirm"]').click();

  await page.locator('[data-action="switch-tab"][data-tab="referee"]').click();

  const initial=await page.evaluate(()=>({code:state.cloudCode,id:state.courtAssignments.court12.currentMatchId,c1:state.courtAssignments.court1.currentMatchId}));
  const preRetirementState=await page.evaluate(()=>JSON.parse(JSON.stringify(state)));
  await page.locator('#court-card-12 [data-action="score"][data-side="A"][data-type="extreme"]').click();
  await page.evaluate(async()=>await flushStationMatchMutations());
  await page.locator('[data-action="switch-tab"][data-tab="settings"]').click();
  await page.locator('#f-stations').fill('8');await page.locator('[data-action="save-meta"]').click();
  await page.waitForFunction(()=>state.courtRetirementPlan?.targetCount===8&&!courtRetirementBusy,null,{timeout:30000});
  const serverRead=()=>page.evaluate(async()=>{
    const sdk=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
    return JSON.parse((await sdk.getDocFromServer(sdk.doc(sdk.getFirestore(),'tournaments',state.cloudCode))).data().data);
  });
  const pending=await serverRead();expect(pending.courtRetirementPlan.targetCount).toBe(8);expect(pending.meta.stations).toBe(12);
  const legacyWrites=await page.evaluate(async stale=>{
    const sdk=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
    const db=sdk.getFirestore(),code=state.cloudCode;
    const attempt=async(ref,patch)=>{try{await sdk.updateDoc(ref,patch);return 'allowed';}catch(e){return e.code||e.message;}};
    return {
      private:await attempt(sdk.doc(db,'tournaments',code),{data:JSON.stringify(stale),updatedAt:Date.now()}),
      public:await attempt(sdk.doc(db,'publicTournaments',code),{bracketView:JSON.stringify({courtLifecycleEpoch:0,stale:true}),updatedAt:Date.now()})
    };
  },preRetirementState);
  expect(legacyWrites).toEqual({private:'permission-denied',public:'permission-denied'});
  expect(pending.matches.find(m=>m.id===initial.id).scoreA).toBe(3);
  expect(pending.matches.filter(m=>!m.completed&&!m.isBye&&m.station>8).length).toBe(4);
  await page.locator('[data-action="switch-tab"][data-tab="referee"]').click();
  await expect(page.locator('body')).toContainText('安全退場');
  // A fresh browser document must restore the cloud plan, not derive a new bracket.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.cloudAuth?.isReady(),null,{timeout:30000});
  await expect(page.locator('[data-action="switch-tab"][data-tab="referee"]').first()).toBeVisible({timeout:30000});
  await page.waitForFunction(code=>state.cloudCode===code&&state.courtRetirementPlan?.targetCount===8,initial.code,{timeout:30000});
  await page.locator('[data-action="switch-tab"][data-tab="referee"]').click();
  await expect(page.locator('#court-card-12 .side-score').first()).toHaveText('3');
  await page.locator('[data-action="court-retirement-transfer"][data-id="'+initial.id+'"][data-station="1"]').click();
  await page.locator('[data-action="modal-confirm"]').click();
  await page.waitForFunction(id=>state.matches.find(m=>m.id===id)?.station===1&&!courtRetirementBusy,initial.id,{timeout:30000});
  const moved=await serverRead();expect(moved.matches.find(m=>m.id===initial.id).scoreA).toBe(3);expect(moved.courtAssignments.court1.currentMatchId).toBe(initial.c1);expect(moved.courtRetirementPlan.courts['12'].status).toBe('retired');
  // Complete each draining court through its actual score/confirmation controls.
  for(const n of [9,10,11]){
    await page.locator('#court-card-'+n+' [data-action="score"][data-side="A"][data-type="extreme"]').click();
    await page.evaluate(async()=>await flushStationMatchMutations());
    await page.locator('#court-card-'+n+' [data-action="score"][data-side="A"][data-type="spin"]').click();
    await page.locator('[data-action="modal-confirm"]').click();
    await page.waitForFunction(i=>state.courtRetirementPlan.courts[i].status==='retired',String(n),{timeout:30000});
  }
  const done=await serverRead();expect(done.meta.stations).toBe(8);expect(done.courtRetirementPlan.status).toBe('completed');expect(done.matches.filter(m=>!m.isBye&&!m.completed&&m.station>8)).toHaveLength(0);
  // Emergency release is independent of planned court-count reduction.
  const emergency=await page.evaluate(()=>({id:state.courtAssignments.court3.currentMatchId,next:state.courtAssignments.court3.nextMatchId,revision:state.matches.find(m=>m.id===state.courtAssignments.court3.currentMatchId).dispatchRevision||0,busy2:state.courtAssignments.court2.currentMatchId}));
  await page.locator('#court-card-3 [data-action="score"][data-side="A"][data-type="extreme"]').click();
  await page.evaluate(async()=>await flushStationMatchMutations());
  await page.locator('#court-card-3 [data-action="court-force-exit"]').click();await page.locator('[data-action="modal-confirm"]').click();
  await page.waitForFunction(()=>state.forcedCourtExits?.[3]?.closed&&!courtRetirementBusy);
  const detached=await serverRead();const dm=detached.matches.find(m=>m.id===emergency.id);
  expect(dm.station).toBe(0);expect(dm.scoreA).toBe(3);expect(dm.completed).toBeFalsy();expect(dm.dispatchRevision).toBe(emergency.revision+1);
  expect(detached.courtAssignments.court3.currentMatchId).toBeNull();expect(detached.courtAssignments.court3.nextMatchId).toBeNull();expect(detached.courtAssignments.court3.lockedBy).toBeNull();
  const rejected=await page.evaluate(async e=>window.cloudSync.mutateMatchTransaction(state.cloudCode,e.id,3,remote=>({ok:true,state:remote}),currentAuthUid(),{expectedRevision:e.revision}),emergency);expect(rejected.ok).toBe(false);expect(rejected.reason).toBe('court-retired');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.cloudAuth?.isReady());await expect(page.locator('[data-action="switch-tab"][data-tab="referee"]').first()).toBeVisible();
  await page.waitForFunction(()=>state.forcedCourtExits?.[3]?.closed);await page.locator('[data-action="switch-tab"][data-tab="referee"]').click();
  await expect(page.locator('body')).toContainText('強制退場｜待接管場次');await expect(page.locator('#court-card-3 [data-action="score"]')).toHaveCount(0);
  await page.locator('[data-action="court-force-claim"][data-id="'+emergency.id+'"][data-station="2"]').click();await page.locator('[data-action="modal-confirm"]').click();
  await page.waitForFunction(id=>state.matches.find(m=>m.id===id).station===2&&!courtRetirementBusy,emergency.id);
  const claimed=await serverRead();expect(claimed.matches.find(m=>m.id===emergency.id).scoreA).toBe(3);expect(claimed.courtAssignments.court2.currentMatchId).toBe(emergency.busy2);
  await page.locator('#court-card-3 [data-action="court-force-reopen"]').click();await page.locator('[data-action="modal-confirm"]').click();await page.waitForFunction(()=>state.forcedCourtExits?.[3]?.closed===false&&!courtRetirementBusy);
  const reopened=await serverRead();expect(reopened.matches.find(m=>m.id===emergency.id).station).toBe(2);expect(reopened.courtAssignments.court3.currentMatchId).not.toBe(emergency.id);
  console.log('FORCED_EXIT_VERIFIED',JSON.stringify({detached:true,scorePreserved:3,reloaded:true,staleScoreRejected:true,takeover:true,reopened:true}));
  expect(externalFirebaseRequests).toEqual([]);console.log('RETIREMENT_VERIFIED',JSON.stringify({players:done.players.length,target:done.meta.stations,scorePreserved:done.matches.find(m=>m.id===initial.id).scoreA,reloaded:true,takeover:true,remaining:done.matches.filter(m=>!m.isBye&&!m.completed).length}));
});
