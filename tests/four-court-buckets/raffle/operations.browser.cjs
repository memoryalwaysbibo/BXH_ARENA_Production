'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { chromium } = require('playwright');
const { fixture, code } = require('../completion/fixture.cjs');

const root = path.resolve(__dirname, '../../..');
const fixtureOrigin = 'http://127.0.0.1:49152';
const roomPath = `tournaments/${code}`;
const allowedMethods = new Set([
  'getTournamentOperations', 'previewTournamentRaffle',
  'drawTournamentRaffle', 'updateTournamentRaffleWinner'
]);

function loadAssembledOperations(directory, db) {
  execFileSync('python3', ['-B', path.join(root, 'scripts/build-bucket-raffle-review.py'),
    '--fixture-tree', '--output', directory]);
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === 'firebase-admin/firestore' && parent?.filename === path.join(directory, 'operations.js')) {
      return { getFirestore: () => db };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
  try {
    return require(path.join(directory, 'operations.js'));
  } finally {
    Module._load = originalLoad;
  }
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bxh-raffle-browser-'));
  let browser;
  try {
    const room = fixture({ bucket: true, courts: 6 });
    const top = room.m.rows.get(roomPath);
    const state = JSON.parse(top.data);
    for (const player of state.players.slice(0, 2)) {
      player.registrationUid = `shared"<&>'account`;
      player.name = `同名玩家 <img src="unexpected-image">`;
    }
    room.m.put(roomPath, { ...top, data: JSON.stringify(state) });
    const operations = loadAssembledOperations(path.join(temporary, 'functions'), room.m.db);
    for (const method of [...allowedMethods].filter(name => name !== 'getTournamentOperations')) {
      assert.equal(typeof operations[method].run, 'function');
      await assert.rejects(operations[method].run({ data: { code } }), error => error.code === 'unauthenticated');
    }

    const coreSource = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
    const escapeFunction = coreSource.match(/^function esc\(s\)\{[\s\S]*?^\}/m)?.[0];
    assert(escapeFunction, 'use the shipped HTML escaping function');
    const operationsSource = fs.readFileSync(path.join(root, 'modules/main-app/tournament-operations.js'), 'utf8');
    const calls = [];
    const failures = [];
    let lostDrawResponse = true;
    let replayedDraw = false;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => route.request().url() === fixtureOrigin + '/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="app"></div>' })
      : route.abort());
    await page.exposeFunction('fixtureOperation', async (method, data) => {
      assert(allowedMethods.has(method));
      calls.push({ method, data });
      const result = await operations[method].run({ auth: { uid: 'admin' }, data });
      if (method === 'drawTournamentRaffle') {
        if (lostDrawResponse) {
          lostDrawResponse = false;
          throw Error('fixture response lost after transaction commit');
        }
        replayedDraw = result.replayed === true;
      }
      return result;
    });
    await page.goto(fixtureOrigin + '/');
    await page.addScriptTag({ content: `${escapeFunction}
      const state = { cloudCode: ${JSON.stringify(code)}, meta: { name: '隔離測試房' } };
      const currentAuthUid = () => 'admin', engagementSessionEpoch = 1, currentRole = 'super_admin';
      const hasAdminAccess = () => true, isSuperAdmin = () => true;
      const cloudTestBusy = false, cloudStatus = 'online', operationsDate = String;
      const showToast = () => {};
      window.confirm = () => true;
      window.prompt = () => '隔離測試原因';
      window.engagementService = { tournamentOperation: window.fixtureOperation };
      function render() { document.getElementById('app').innerHTML = window.BXHTournamentOperations.renderTournamentOperationsPage(); }
    ` });
    await page.addScriptTag({ content: operationsSource });
    await page.evaluate(() => {
      document.addEventListener('click', event => {
        const target = event.target.closest('[data-action^="ops-"]');
        if (target) window.BXHTournamentOperations.handleTournamentOperationsAction(target.dataset.action, target);
      });
      render();
    });
    await page.locator('[data-ops-prize-key="name"]').fill('測試獎品');
    await page.locator('[data-ops-prize-key="quantity"]').fill('3');
    await page.locator('[data-action="ops-preview"]').click();
    await page.getByText('符合資格：4 人', { exact: false }).waitFor();
    await page.locator('[data-action="ops-draw"]').click();
    await page.locator('[data-action="ops-retry"]').click();
    await page.getByText('待領獎', { exact: true }).first().waitFor();
    assert.equal(await page.locator('img[src="unexpected-image"]').count(), 0);
    const drawCalls = calls.filter(call => call.method === 'drawTournamentRaffle');
    assert.equal(drawCalls.length, 2);
    assert.deepEqual(drawCalls[0].data, drawCalls[1].data);
    assert.equal(replayedDraw, true);
    const records = [...room.m.rows].filter(([key]) => key.startsWith(roomPath + '/raffles/'));
    assert.equal(records.length, 1);
    const [recordPath, record] = records[0];
    const familyWinner = record.winners.find(winner => ['p1', 'p2'].includes(winner.playerId));
    assert(familyWinner, 'three winners from four include at least one of the two family participants');
    const winnerButtons = page.locator('[data-action="ops-forfeit"]');
    const winnerIndex = (await winnerButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('data-winner')))).indexOf(familyWinner.key);
    assert(winnerIndex >= 0, 'HTML data attribute round-trips the full tuple key');
    await winnerButtons.nth(winnerIndex).click();
    await page.locator('[data-action="ops-replace"]').click();
    await page.getByText('已補抽', { exact: true }).waitFor();
    const replacement = room.m.rows.get(recordPath).winners.at(-1);
    assert.equal(replacement.replaces, familyWinner.key);
    const claims = page.locator('[data-action="ops-claim"]');
    const claimIndex = (await claims.evaluateAll(buttons => buttons.map(button => button.getAttribute('data-winner')))).indexOf(replacement.key);
    assert(claimIndex >= 0);
    await claims.nth(claimIndex).click();
    await page.getByText('已領獎', { exact: true }).waitFor();
    const winnerCalls = calls.filter(call => call.method === 'updateTournamentRaffleWinner');
    assert.deepEqual(winnerCalls.map(call => [call.data.action, call.data.winnerKey]), [
      ['forfeit', familyWinner.key], ['replace', familyWinner.key], ['claim', replacement.key]
    ]);
    assert.equal(room.m.rows.get(recordPath).winners.at(-1).status, 'claimed');
    assert.equal(room.m.writes.filter(write => write.kind === 'create' && write.path === recordPath).length, 1);
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ assembledCallableExports: 3, browserRaffleFlow: 'passed',
      sameOperationReplay: true, exactWinnerKeyRoundTrip: true, productionRequests: 0, productionWrites: 0 }));
  } finally {
    if (browser) await browser.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
