'use strict';
/** Browser/transport regression with REAL Auth/Firestore Emulators and SYNTHETIC
 * research shapes. This never verifies the private original DATA-01B source. */
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, Timestamp, FieldValue} = require('firebase-admin/firestore');
const {chromium} = require('@playwright/test');
const {startLocalReviewServer} = require('../../modules/bey-catalog/catalog-local-review-server.cjs');
const {createTw15AdminEmulatorGuards} = require('../../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
const target = {mode: 'emulator', projectId: 'demo-bxh-catalog-db01', emulatorHost: '127.0.0.1:8189'};
if (process.env.FIRESTORE_EMULATOR_HOST !== target.emulatorHost || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098')
 throw Error('LOCAL_REVIEW_TEST_EMULATORS_REQUIRED');
const app = initializeApp({projectId: target.projectId}, 'catalog-local-ui-test');
const auth = getAuth(app), db = getFirestore(app);
const password = 'Public-emulator-only-test-password';
const ids = ['local_api_admin', 'local_ui_admin', 'local_ui_denied', 'local_ui_expired', 'local_ui_stale'];
let server, browser, loads = 0;
function syntheticBatch() {
 const b = {batchId: 'DATA-01B-20261009-ZHTW-TW05', productionWritable: false, autoPublish: false,
  sources: [], products: [{productId: 'synthetic_product', localizationStatus: 'provisional_translation'}],
  parts: [], variants: [], colors: [], options: [], assemblyClaims: [], contentClaims: [], issues: []};
 for (let i = 1; i <= 11; i++) b.parts.push({partId: 'synthetic_part_' + i,
  ...(i <= 3 ? {localizationStatus: 'taiwan_name_pending'} : {verificationStatus: 'supplier_pending'})});
 for (let i = 1; i <= 5; i++) b.assemblyClaims.push({groupId: 'synthetic_group_' + i, verificationStatus: 'supplier_pending',
  ...(i <= 2 ? {localizationStatus: 'taiwan_name_pending_supplier_source'} : {})});
 for (let i = 1; i <= 11; i++) b.variants.push({variantId: 'synthetic_variant_' + i, colorPhysicalVerification: 'pending',
  ...(i === 10 ? {localizationStatus: 'product_source_verified_color_pending'} : {})});
 for (let i = 0; i < 169; i++) b.issues.push({issueId: 'synthetic_issue_' + i});
 return b;
}
before(async () => {
 for (const uid of ids) {
  await auth.createUser({uid, email: uid + '@example.invalid', password});
  await db.collection('users').doc(uid).set({role: uid === 'local_ui_denied' ? 'player' : 'admin', active: true, isTestAccount: false});
 }
 // Hold the injected clock inside one quota window so a real minute boundary cannot make the browser test flaky.
 const guards = createTw15AdminEmulatorGuards({db, target, Timestamp, FieldValue, secret: 'public-local-ui-test-secret-never-production', clock: () => 60000});
 server = await startLocalReviewServer({target, dependencies: {
  adminAuth: auth, adminFirestore: db, ...guards, loadResearchBatch: async () => {loads++; return syntheticBatch();}
 }});
 browser = await chromium.launch({headless: true});
});
after(async () => {if (browser) await browser.close(); if (server) await server.close(); await deleteApp(app);});
async function api(path, body, {token, headers = {}, method = 'POST'} = {}) {
 if (headers.host) return new Promise((resolve, reject) => {
  // Undici may normalize Host to the URL authority; use raw HTTP to actually test rebinding.
  const request = http.request(server.url + path, {method, headers: {origin: server.url, 'content-type': 'application/json', ...headers}}, response => {
   const chunks = []; response.on('data', chunk => chunks.push(chunk));
   response.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: response.statusCode, headers: response.headers})));
  });
  request.on('error', reject); request.end(JSON.stringify(body));
 });
 return fetch(server.url + path, {method, headers: {origin: server.url, 'content-type': 'application/json',
  ...(token ? {authorization: 'Bearer ' + token} : {}), ...headers},
  body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
}
async function login(page, uid) {
 await page.goto(server.url);
 await page.locator('#email').fill(uid + '@example.invalid'); await page.locator('#password').fill(password);
 await page.locator('#login-button').click();
}
test('same-origin local transport rejects remote origin, DNS rebinding, payload injection and broken JSON', async () => {
 for (const [path, body, options, expected] of [
  ['/api/session', {}, {headers: {origin: 'https://foreign.invalid'}}, 403],
  ['/api/session', {}, {headers: {host: 'rebound.invalid'}}, 403],
  ['/api/session', {}, {method: 'GET'}, 405],
  ['/api/session', '{broken-private-content', {}, 400],
  ['/api/session', {email: 'x@example.invalid', password, role: 'admin'}, {}, 400],
  ['/api/review', {fixtureFile: '/private/source'}, {}, 400],
  ['/api/review', {query: 'x'.repeat(4200)}, {}, 400]
 ]) {
  const response = await api(path, body, options); assert.equal(response.status, expected, JSON.stringify(options));
  const raw = await response.text(); assert(!raw.includes('broken-private-content')); assert(!raw.includes('/private/source'));
 }
 const response = await fetch(server.url);
 assert.equal(response.headers.get('cache-control'), 'no-store');
 assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
 assert.equal(loads, 0);
});
test('real test login exposes only ID token; unauthenticated and player reads do not load research', async () => {
 assert.equal((await api('/api/review', {})).status, 401);
 const bad = await api('/api/session', {email: ids[0] + '@example.invalid', password: 'wrong-password'});
 assert.equal(bad.status, 401); assert.deepEqual(await bad.json(), {error: 'UNAUTHENTICATED'});
 const response = await api('/api/session', {email: 'local_ui_denied@example.invalid', password});
 const session = await response.json(); assert.deepEqual(Object.keys(session), ['idToken']);
 assert.equal((await api('/api/review', {}, {token: session.idToken})).status, 403);
 assert.equal(loads, 0);
});
test('mobile browser reads 10/10/10/1, filters P0 and displays real quota rejection without credential storage', async () => {
 const page = await browser.newPage({viewport: {width: 390, height: 844}});
 try {
  await login(page, 'local_ui_admin');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 10);
  for (const count of [20, 30, 31]) {
   await page.locator('#next').click(); await page.waitForFunction(n => document.querySelectorAll('.card').length === n, count);
  }
  assert.equal(await page.locator('#next').isVisible(), false);
  assert.match(await page.locator('#count').innerText(), /31／31/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.equal(await page.locator('#password').inputValue(), '');
  await page.locator('[data-filter="P0"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 5);
  assert.equal(await page.locator('#p0').innerText(), '5');
  await page.locator('#search').fill('synthetic_part'); await page.locator('#search-button').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('讀取次數'));
  assert.equal(await page.locator('.card').count(), 0);
  await page.locator('#logout').click();
  assert.equal(await page.locator('#review').isVisible(), false); assert.equal(await page.locator('.card').count(), 0);
 } finally {await page.close();}
});
test('browser displays forbidden, searches, rejects stale cursor and clears disabled-account data', async () => {
 const page = await browser.newPage();
 try {
  await login(page, 'local_ui_denied');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('沒有讀取權限'));
  assert.equal(await page.locator('.card').count(), 0); await page.locator('#logout').click();
  await login(page, 'local_ui_expired'); await page.waitForFunction(() => document.querySelectorAll('.card').length === 10);
  await page.locator('#search').fill('synthetic_variant_10'); await page.locator('#search-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  assert.equal(await page.locator('#next').isVisible(), false);
  await page.locator('#search').fill(''); await page.locator('#search-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 10);
  const once = async route => {await route.fulfill({status: 400, contentType: 'application/json', body: '{"error":"INVALID_REQUEST"}'});};
  await page.route('**/api/review', once, {times: 1}); await page.locator('#next').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('資料版本'));
  assert.equal(await page.locator('.card').count(), 0); assert.equal(await page.locator('#next').isVisible(), false);
  await auth.updateUser('local_ui_expired', {disabled: true}); await page.locator('#search-button').click();
  await page.waitForFunction(() => !document.getElementById('login').hidden);
  assert.equal(await page.locator('.card').count(), 0); assert.equal(await page.locator('#review').isVisible(), false);
 } finally {await page.close();}
});
test('logout during a pending request prevents stale cards returning; untrusted response text never becomes HTML', async () => {
 const page = await browser.newPage(); let release;
 try {
  await login(page, 'local_ui_stale'); await page.waitForFunction(() => document.querySelectorAll('.card').length === 10);
  await page.route('**/api/review', async route => {
   const response = await route.fetch(); const data = await response.json();
   data.items[0].details = '<img src=x onerror="window.xss=1">';
   await route.fulfill({response, json: data});
  }, {times: 1});
  await page.locator('#search-button').click();
  await page.waitForFunction(() => document.querySelector('.card h2')?.textContent.includes('<img'));
  assert.equal(await page.locator('#items img').count(), 0); assert.equal(await page.evaluate(() => window.xss), undefined);
  const wait = new Promise(resolve => {release = resolve;});
  let arrived; const seen = new Promise(resolve => {arrived = resolve;});
  await page.route('**/api/review', async route => {arrived(); await wait; try {await route.continue();} catch {}}, {times: 1});
  await page.locator('#search-button').click(); await seen; await page.locator('#logout').click(); release();
  assert.equal(await page.locator('#review').isVisible(), false); assert.equal(await page.locator('.card').count(), 0);
  await page.reload(); assert.equal(await page.locator('#login').isVisible(), true);
 } finally {release?.(); await page.close();}
});
test('changed Emulator configuration fails closed after startup', async () => {
 const prior = process.env.FIRESTORE_EMULATOR_HOST;
 try {
  process.env.FIRESTORE_EMULATOR_HOST = 'production.invalid:443';
  assert.equal((await api('/api/review', {})).status, 503);
  await assert.rejects(() => startLocalReviewServer({target, dependencies: {adminFirestore: db}}), /LOCAL_REVIEW_EMULATORS_REQUIRED/);
 } finally {process.env.FIRESTORE_EMULATOR_HOST = prior;}
});
