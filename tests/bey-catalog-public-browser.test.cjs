'use strict';
/**
 * Real Chromium QA for the public read-only catalog, isolated from the main app.
 * Run: node --test tests/bey-catalog-public-browser.test.cjs
 * Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, PUBLIC_CATALOG_QA_OUTPUT_DIR.
 * Serves an exact asset allowlist on 127.0.0.1; blocks every off-origin request.
 * Never starts production authentication, Firestore, the private loader or emulators.
 * Explicitly labelled synthetic cases repin an in-memory model copy only. They do
 * not modify or claim to be the real reviewed snapshot, nor exercise app auth E2E.
 */
const {test, describe, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.resolve(process.env.PUBLIC_CATALOG_QA_OUTPUT_DIR || path.join(os.tmpdir(), 'bxh-public-catalog-browser'));
const MODEL_PATH = '/modules/bey-catalog/catalog-public-model.js';
const UI_PATH = '/modules/bey-catalog/catalog-public-ui.js';
const ASSET_PATHS = ['/bey-catalog.html', '/bey-catalog.css', MODEL_PATH, UI_PATH];
const model = require('..' + MODEL_PATH);
const DATA_PATH = '/' + model.DATA_URL.replace(/^\.\//, '');
const baseline = fs.readFileSync(path.join(ROOT, DATA_PATH));
const payload = JSON.parse(baseline.toString('utf8'));
const baselineModel = fs.readFileSync(path.join(ROOT, MODEL_PATH), 'utf8');
const report = {scope: 'Public entry static audit plus isolated catalog Chromium scenarios. Main-app authentication and production are never exercised.', startedAt: new Date().toISOString(), browser: {status: 'not_run', reason: 'No Chromium launch has completed in this invocation'}, expectedBrowserScenarios: 14, checks: [], sessions: []};
fs.mkdirSync(OUTPUT, {recursive: true});

function saveReport() {
  fs.writeFileSync(path.join(OUTPUT, 'browser-qa-report.json'), JSON.stringify(report, null, 2) + '\n');
}
function countBy(items, key) {
  return Object.fromEntries([...new Set(items.map(row => row[key]))].map(value => [value, items.filter(row => row[key] === value).length]));
}
function copyPayload() { return JSON.parse(baseline.toString('utf8')); }
function integrationAnchors() {
  const source = fs.readFileSync(path.join(ROOT, 'modules/main-app/core.js'), 'utf8');
  return source.match(/<a\b[^>]*href=["'](?:\.\/)?bey-catalog\.html["'][^>]*>[\s\S]*?<\/a>/g) || [];
}
function syntheticSnapshot(data) {
  const body = Buffer.from(JSON.stringify(data));
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const source = baselineModel.replace(model.EXPECTED_SHA256, hash).replace(/const EXPECTED_BYTES = \d+;/, `const EXPECTED_BYTES = ${body.length};`);
  assert.notEqual(source, baselineModel);
  return {body, hash, source, dataPath: `/data/bey-catalog/public-catalog.${hash}.json`};
}

test('public integration anchor is a plain catalog link, audited without executing the main app', () => {
  const links = integrationAnchors();
  assert.equal(links.length, 1, 'one additive public entry, not a new production route');
  assert.doesNotMatch(links[0], /onclick\s*=|javascript:|firebase|token|auth\(/i);
  report.checks.push({name: 'main app anchor static audit', status: 'passed', limitation: 'Does not execute main app or authentication'});
  saveReport();
});

describe('real Chromium public catalog isolation and behavior', {concurrency: false}, () => {
  let browser;
  before(async () => {
    try {
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
      browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {}), args: ['--no-sandbox']});
      report.browser = {version: browser.version(), executablePath: executablePath || 'Playwright installed Chromium', status: 'started'};
      saveReport();
    } catch (error) {
      report.browser = {status: 'not_run', reason: String(error)};
      saveReport();
      throw error;
    }
  });
  after(async () => {
    if (browser) await browser.close();
    if (browser) report.browser.status = report.sessions.every(session => session.status === 'passed') ? 'passed_selected_scenarios' : 'failed';
    report.coverage = {executedBrowserScenarios: report.sessions.length, notRunBrowserScenarios: 14 - report.sessions.length};
    report.finishedAt = new Date().toISOString();
    saveReport();
  });

  async function scenario(name, fn, {viewport = {width: 1440, height: 1000}, fixture} = {}) {
    const state = {mode: 'valid', dataRequests: 0, intentional404s: 0, requests: [], rejectedRequests: []};
    const chosenDataPath = fixture?.dataPath || DATA_PATH;
    const allowed = new Set([...ASSET_PATHS, chosenDataPath, '/fixture-home.html', '/index.html', '/favicon.ico']);
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      state.requests.push({method: request.method, path: url.pathname});
      if (request.method !== 'GET' || !allowed.has(url.pathname)) {
        state.rejectedRequests.push({method: request.method, path: url.pathname});
        response.writeHead(404).end('Not found'); return;
      }
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (url.pathname === '/fixture-home.html' || url.pathname === '/index.html') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        // A harmless origin-local navigation fixture, not the production main app.
        response.end('<!doctype html><html lang="zh-Hant"><title>Readonly navigation fixture</title>' + integrationAnchors()[0] + '</html>'); return;
      }
      if (url.pathname === chosenDataPath) {
        state.dataRequests++;
        if (state.mode === '404') { state.intentional404s++; response.writeHead(404).end('Not found'); return; }
        response.setHeader('content-type', 'application/json; charset=utf-8');
        if (state.mode === 'malformed') { response.end('{malformed'); return; }
        if (state.mode === 'hash-mismatch') {
          const wrong = Buffer.from(baseline); wrong[1] = wrong[1] === 32 ? 10 : 32;
          assert.equal(wrong.length, baseline.length); response.end(wrong); return;
        }
        response.end(fixture?.body || baseline); return;
      }
      response.setHeader('content-type', url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8');
      response.end(url.pathname === MODEL_PATH && fixture ? fixture.source : fs.readFileSync(path.join(ROOT, url.pathname)));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    const session = {name, viewport, fixture: fixture ? 'synthetic repinned in-memory snapshot' : 'reviewed exact-byte snapshot', pageErrors: [], consoleErrors: [], offOriginRequests: [], requests: state.requests, status: 'running'};
    report.sessions.push(session);
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {session.offOriginRequests.push(request.url()); await route.abort('blockedbyclient'); return;}
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => session.pageErrors.push(String(error)));
    page.on('console', message => {if (message.type() === 'error') session.consoleErrors.push(message.text());});
    try {
      await fn({page, context, state, origin, session});
      assert.deepEqual(session.pageErrors, [], 'no uncaught page errors');
      assert.deepEqual(session.offOriginRequests, [], 'no auth, database or other off-origin requests');
      assert.deepEqual(state.rejectedRequests, [], 'only allowlisted public assets requested');
      const unexpected = session.consoleErrors.filter(message => !(state.intentional404s && /^Failed to load resource: the server responded with a status of 404/.test(message)));
      assert.deepEqual(unexpected, [], 'no unexpected console errors (an intentionally injected 404 is tracked separately)');
      session.status = 'passed';
    } catch (error) {
      session.status = 'failed'; session.error = String(error);
      try {await page.screenshot({path: path.join(OUTPUT, name.replace(/[^a-z0-9]+/gi, '-') + '-FAILED.png'), fullPage: true});} catch (_) {}
      throw error;
    } finally {
      session.dataRequests = state.dataRequests;
      session.intentional404s = state.intentional404s;
      await context.close();
      await new Promise(resolve => server.close(resolve));
      saveReport();
    }
  }
  async function loaded(page, origin) {
    await page.goto(origin + '/bey-catalog.html');
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
    assert.equal(await page.locator('#catalog-retry').isVisible(), false);
  }
  async function noOverflow(page) {
    const dimensions = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
    assert(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport, JSON.stringify(dimensions));
  }
  async function screenshot(page, filename, fullPage = true) {
    await page.screenshot({path: path.join(OUTPUT, filename), fullPage});
  }
  async function visibleCards(page, kind) {
    return page.locator(kind === 'parts' ? '[data-part-id]' : '[data-product-id]').count();
  }
  async function errorState(page) {
    await page.locator('#catalog-retry').waitFor({state: 'visible'});
    assert.equal(await page.locator('[data-product-id], [data-part-id]').count(), 0);
    assert.equal((await page.locator('#catalog-results').innerText()).trim(), '');
    assert.notEqual((await page.locator('#catalog-status').innerText()).trim(), '');
  }

  test('desktop renders exact public counts, source links and partial composition honestly', async () => scenario('desktop-public-snapshot', async ({page, origin, state}) => {
    await loaded(page, origin);
    assert.match(await page.locator('#catalog-product-count').innerText(), /9/);
    assert.match(await page.locator('#catalog-part-count').innerText(), /45/);
    assert.equal(await visibleCards(page, 'products'), 9);
    assert.equal(state.dataRequests, 1);
    const allText = await page.locator('body').innerText();
    assert(allText.includes('戰鬥陀螺X・公開圖鑑'));
    assert(allText.includes('中文名稱為暫譯，非台灣官方命名'));
    for (const product of payload.products) {
      const card = page.locator(`[data-product-id="${product.productId}"]`);
      const title = card.locator('h2');
      assert((await title.innerText()).includes(model.displayName(product).primary));
      assert.equal(await title.getAttribute('data-name-status'), 'provisional_translation');
      assert.equal(await title.getAttribute('lang'), 'zh-Hant-TW');
      assert(allText.includes(product.originalName), 'verbatim originals remain visibly secondary');
    }
    const cx00 = page.locator('[data-product-id="product_000009"]');
    assert((await cx00.locator('h2').innerText()).includes('陀螺對戰通行證貼紙'));
    assert.doesNotMatch(allText, /taiwanName|verificationStatus|reviewerUid|sourceBytesHash|batchBytesHash|registryVersion|colorPhysicalVerification|partsResolved|expectedIndependentParts/);
    assert.equal(await page.locator('form[action], input[type="password"], iframe, canvas, video, audio').count(), 0);
    assert.deepEqual(await page.evaluate(() => ({local: localStorage.length, session: sessionStorage.length})), {local: 0, session: 0});
    const links = await page.locator('.catalog-source-link').evaluateAll(nodes => nodes.map(node => ({href: node.href, target: node.target, rel: node.rel})));
    assert(links.length > 0);
    for (const link of links) {
      assert.equal(model.safeSourceUrl(link.href), link.href, 'only reviewed exact official sources');
      assert.equal(link.target, '_blank');
      assert(/\bnoopener\b/.test(link.rel));
      assert(/\bnoreferrer\b/.test(link.rel));
    }
    const partial = page.locator('[data-product-id="product_000006"]');
    await partial.locator('summary').click();
    const text = await partial.innerText();
    assert(text.includes('UX-18'));
    assert.match(text, /未.*完整|不.*完整|部分|尚未|待補/);
    // UX-18-05 has no complete group in this snapshot. The UI must not invent one.
    assert.equal(payload.assemblyRelations.some(row => row.optionId === 'option_000010'), false);
    const incompleteOption = partial.locator('[data-option-id="option_000010"]');
    assert.equal(await incompleteOption.count(), 1);
    assert.equal(await incompleteOption.locator('[data-group-id]').count(), 0);
    assert.match(await incompleteOption.innerText(), /部件清單待補/);
    for (const optionId of ['option_000008', 'option_000009']) {
      assert.equal(await partial.locator(`[data-option-id="${optionId}"] .parts-list li`).count(), 5, 'evidenced CX options retain all five parts');
    }
    assert.equal(await page.locator('[data-group-id]').count(), 11);
    assert.doesNotMatch(text, /UX-18-05[^\n]*(?:完整組成|完整配置)/);
    await noOverflow(page);
    await screenshot(page, 'desktop-products.png');
  }));

  test('product and part search, every category, empty results, reset and repeated tabs', async () => scenario('search-filter-reset', async ({page, origin, state}) => {
    await loaded(page, origin);
    await page.locator('#catalog-search').fill('ＵＸ－０３');
    assert.equal(await visibleCards(page, 'products'), 1);
    assert.match(await page.locator('#catalog-results').innerText(), /UX-03/);
    await page.locator('#catalog-reset').click();
    assert.equal(await visibleCards(page, 'products'), 9);
    for (const [category, count] of Object.entries(countBy(payload.products, 'packageType'))) {
      await page.locator('#catalog-category').selectOption(category);
      assert.equal(await visibleCards(page, 'products'), count, category);
    }
    await page.locator('#catalog-reset').click();
    await page.locator('[data-catalog-tab="parts"]').click();
    assert.equal(await page.locator('[data-catalog-tab="parts"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await visibleCards(page, 'parts'), 45);
    for (const [category, count] of Object.entries(countBy(payload.parts, 'category'))) {
      await page.locator('#catalog-category').selectOption(category);
      assert.equal(await visibleCards(page, 'parts'), count, category);
    }
    await page.locator('#catalog-reset').click();
    await page.locator('#catalog-search').fill('ウィザードロッド');
    assert.equal(await visibleCards(page, 'parts'), 1);
    await page.locator('#catalog-search').fill('NO_MATCH_TEST_983642');
    assert.equal(await visibleCards(page, 'parts'), 0);
    assert.match(await page.locator('body').innerText(), /沒有|找不到|無符合/);
    await screenshot(page, 'desktop-empty-state.png', false);
    await page.locator('#catalog-reset').click();
    assert.equal(await page.locator('#catalog-search').inputValue(), '');
    assert.equal(await visibleCards(page, 'parts'), 45);
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-catalog-tab="products"]').click();
      assert.equal(await visibleCards(page, 'products'), 9);
      await page.locator('[data-catalog-tab="parts"]').click();
      assert.equal(await visibleCards(page, 'parts'), 45);
    }
    for (const part of payload.parts) {
      const card = page.locator(`[data-part-id="${part.partId}"]`), name = model.displayName(part);
      assert((await card.locator('h2').innerText()).includes(name.primary));
      assert.equal(await card.locator('h2').getAttribute('data-name-status'), name.status);
      assert((await card.innerText()).includes(part.originalName));
    }
    for (const query of ['布拉許', '索爾', 'DB 軸心', '5-70 棘輪']) {
      await page.locator('#catalog-search').fill(query);
      assert.equal(await visibleCards(page, 'parts'), 1, query);
    }
    await page.locator('#catalog-reset').click();
    await page.locator('[data-catalog-tab="products"]').click();
    for (const query of ['魔導神杖', 'UX-18-03', 'ｕｘ１８０３', '古屍詛咒 4-60C']) {
      await page.locator('#catalog-search').fill(query);
      assert.equal(await visibleCards(page, 'products'), 1, query);
    }
    await page.locator('#catalog-reset').click();
    await page.locator('[data-catalog-tab="parts"]').click();
    assert.equal(state.dataRequests, 1, 'client filtering does not refetch or call backend');
    await noOverflow(page);
    await screenshot(page, 'desktop-parts.png');
  }));

  for (const width of [320, 375]) test(`mobile ${width}px has usable controls and no horizontal overflow`, async () => scenario(`mobile-${width}`, async ({page, origin}) => {
    await loaded(page, origin);
    await noOverflow(page);
    await screenshot(page, `mobile-${width}-products.png`, false);
    const cx00 = page.locator('[data-product-id="product_000009"]');
    assert((await cx00.locator('h2').innerText()).includes('陀螺對戰通行證貼紙'));
    await cx00.locator('summary').click();
    await noOverflow(page);
    await page.locator('#catalog-search').fill('布拉許');
    assert.equal(await visibleCards(page, 'products'), 1);
    const ux18 = page.locator('[data-product-id="product_000006"]');
    await ux18.locator('summary').click();
    const option = ux18.locator('[data-option-id="option_000008"]');
    assert((await option.innerText()).includes('天馬布拉許 M3-85W'));
    assert((await option.innerText()).includes('ペガサスブラッシュM3-85W'));
    await noOverflow(page);
    await page.locator('#catalog-reset').click();
    await page.locator('[data-catalog-tab="parts"]').click();
    await page.locator('#catalog-category').selectOption('blade_ratchet');
    assert.equal(await visibleCards(page, 'parts'), 2);
    await noOverflow(page);
    await screenshot(page, `mobile-${width}-parts.png`, false);
    await page.locator('#catalog-search').fill('NO_MATCH_MOBILE');
    await noOverflow(page);
    await page.locator('#catalog-reset').click();
    assert.equal(await visibleCards(page, 'parts'), 45);
  }, {viewport: {width, height: 812}}));

  for (const mode of ['404', 'malformed', 'hash-mismatch']) test(`${mode} fails closed and explicit retry recovers`, async () => scenario(`failure-${mode}`, async ({page, origin, state}) => {
    state.mode = mode;
    await page.goto(origin + '/bey-catalog.html');
    await errorState(page);
    await noOverflow(page);
    await screenshot(page, `${mode}-failure.png`, false);
    state.mode = 'valid';
    await page.locator('#catalog-retry').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
    assert.equal(await page.locator('#catalog-retry').isVisible(), false);
    assert.equal(state.dataRequests, 2);
  }));

  test('Back, Forward, reload and repeated entry do not keep stale failed data', async () => scenario('history-reload-repeated-entry', async ({page, origin, state}) => {
    await page.goto(origin + '/fixture-home.html');
    await page.locator('[data-catalog-entry="public"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
    await page.locator('[data-catalog-tab="parts"]').click();
    await page.goBack();
    assert.equal(new URL(page.url()).pathname, '/fixture-home.html');
    await page.goForward();
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id], [data-part-id]').length > 0);
    await page.locator('.return-link').click();
    assert.equal(new URL(page.url()).pathname, '/index.html');
    await page.locator('[data-catalog-entry="public"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
    state.mode = '404';
    await page.reload();
    await errorState(page);
    state.mode = 'valid';
    for (let i = 0; i < 3; i++) {
      await page.goto(origin + '/fixture-home.html');
      await page.locator('[data-catalog-entry="public"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-product-id]').length === 9);
      assert.equal(await page.locator('[data-product-id]').count(), 9, 'no duplicate event/render state');
    }
  }));

  test('synthetic repinned text is rendered literally, never executed as HTML', async () => {
    const data = copyPayload();
    const attack = '<img src=x onerror="window.__catalogXss=1"><svg onload="window.__catalogXss=2">';
    data.products[0].originalName = attack;
    data.parts[0].originalName = attack;
    await scenario('synthetic-text-only-xss', async ({page, origin}) => {
      await loaded(page, origin);
      assert((await page.locator('[data-product-id="product_000001"]').innerText()).includes(attack));
      assert.equal(await page.locator('#catalog-results img, #catalog-results svg, #catalog-results script').count(), 0);
      assert.equal(await page.evaluate(() => window.__catalogXss), undefined);
      await page.locator('[data-catalog-tab="parts"]').click();
      assert((await page.locator('[data-part-id="part_000001"]').innerText()).includes(attack));
      assert.equal(await page.evaluate(() => window.__catalogXss), undefined);
      await noOverflow(page);
    }, {fixture: syntheticSnapshot(data)});
  });

  const invalidFixtures = {
    'unverified-field': data => {data.products[0].taiwanName = 'SYNTHETIC_UNVERIFIED_FIELD_MUST_NOT_RENDER';},
    'unsafe-source': data => {data.products[0].sourceUrls.originalName = ['javascript:window.__catalogXss=1'];},
    'lookalike-source': data => {data.products[0].sourceUrls.originalName = ['https://beyblade.takaratomy.co.jp.attacker.invalid/catalog'];},
    'product-completeness': data => {data.products[0].compositionComplete = true;},
    'broken-reference': data => {data.contentFacts[0].partId = 'part_999999';}
  };
  for (const [name, change] of Object.entries(invalidFixtures)) test(`synthetic valid-hash ${name} is rejected before any rendering`, async () => {
    const data = copyPayload(); change(data);
    await scenario('synthetic-' + name, async ({page, origin}) => {
      await page.goto(origin + '/bey-catalog.html');
      await errorState(page);
      assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_UNVERIFIED_FIELD_MUST_NOT_RENDER|attacker\.invalid/);
      assert.equal(await page.evaluate(() => window.__catalogXss), undefined);
    }, {fixture: syntheticSnapshot(data)});
  });
});
