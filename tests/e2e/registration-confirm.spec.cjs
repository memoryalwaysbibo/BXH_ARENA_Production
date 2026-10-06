'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const family = fs.readFileSync(path.join(root, 'family-ui.js'), 'utf8');
const start = family.indexOf('async function chooseFamilyParticipant(');
const end = family.indexOf('// v13.40.0', start);
const source = family.slice(start, end);
if (start < 0 || end < 0) throw Error('Registration dialog source missing');

// Exercise the real dialog with an isolated in-memory service. No Firebase,
// real registrations, credentials or production requests are involved.
async function setup(page, mode = 'self', options = {}) {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><button id="open">報名</button>');
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'raffle-claims.css'), 'utf8') });
  await page.addScriptTag({ content: `
    let engagementSessionEpoch = 1;
    const currentAuthUid = () => 'fixture-guardian';
    const userProfile = { displayName: '測試玩家' };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    window.fixture = { mode: ${JSON.stringify(mode)}, options: ${JSON.stringify(options)}, calls: [], pending: [], sent: [], error: null };
    const previewResult = ids => ({ ok: true, rows: ids.map(id => ({ participantName: id || '測試玩家', status: id === 'child-2' ? 'waitlist' : 'confirmed' })), allocation: ids.map(id => ({ participantId: id, status: id === 'child-2' ? 'waitlist' : 'confirmed' })) });
    window.engagementService = {
      family: async () => ({ ok: true, profiles: [{ id:'child-1', name:'孩子一' }, { id:'child-2', name:'孩子二' }] }),
      familyRegistration: async payload => {
        fixture.calls.push(payload);
        if (payload.action === 'mine') return { ok:true, rows:[] };
        if (payload.action !== 'preview') throw Error('Unexpected service action');
        if (fixture.options.fail) throw Error('full');
        if (fixture.options.hold) return new Promise(resolve => fixture.pending.push({ resolve, ids: payload.childIds }));
        return previewResult(payload.childIds);
      }
    };
    fixture.resolvePreview = index => { const item = fixture.pending[index]; item.resolve(previewResult(item.ids)); };
    ${source}
    document.getElementById('open').onclick = () => {
      chooseFamilyParticipant({ name:'測試賽事', fee:100 }, 'FIXTURE', true, fixture.mode)
        .then(value => fixture.sent.push(value)).catch(error => fixture.error = error.message);
    };
  ` });
  page.on('dialog', dialog => { throw Error('Unexpected second confirmation: ' + dialog.message()); });
  await page.click('#open');
  await expect(page.locator('dialog')).toBeVisible();
}

test('self registration previews before one confirmation and resolves once', async ({ page }) => {
  await setup(page);
  await expect(page.locator('[data-family="allocation"]')).toContainText('測試玩家：正取');
  await expect(page.locator('dialog')).toContainText('測試賽事');
  await expect(page.locator('dialog')).toContainText('100 元');
  expect(await page.evaluate(() => fixture.sent.length)).toBe(0);
  await page.getByRole('button', { name:'確認報名', exact:true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => fixture.sent)).toEqual([{ childIds:[null], allocation:[{ participantId:null, status:'confirmed' }] }]);
});

test('latest child selection wins when previews return out of order', async ({ page }) => {
  await setup(page, 'children', { hold:true });
  const submit = page.getByRole('button', { name:'確認報名', exact:true });
  await expect(submit).toBeDisabled();
  await page.locator('[value="child-1"]').check();
  await page.locator('[value="child-1"]').uncheck();
  await page.locator('[value="child-2"]').check();
  await expect.poll(() => page.evaluate(() => fixture.pending.length)).toBe(2);
  await page.evaluate(() => fixture.resolvePreview(1));
  await expect(page.locator('[data-family="allocation"]')).toContainText('child-2：備取');
  await page.evaluate(() => fixture.resolvePreview(0));
  await expect(page.locator('[data-family="allocation"]')).toContainText('child-2：備取');
  await submit.click();
  expect(await page.evaluate(() => fixture.sent[0].childIds)).toEqual(['child-2']);
});

test('failed preview blocks confirmation and can be retried in place', async ({ page }) => {
  await setup(page, 'self', { fail:true });
  await expect(page.locator('[data-family="allocation"]')).toContainText('正取與備取皆已額滿');
  await expect(page.getByRole('button', { name:'確認報名', exact:true })).toBeDisabled();
  await page.evaluate(() => { fixture.options.fail = false; });
  await page.getByRole('button', { name:'重新檢查名額' }).click();
  await expect(page.getByRole('button', { name:'確認報名', exact:true })).toBeEnabled();
  expect(await page.evaluate(() => fixture.sent.length)).toBe(0);
});

test('cancel during a pending preview never submits', async ({ page }) => {
  await setup(page, 'self', { hold:true });
  await expect.poll(() => page.evaluate(() => fixture.pending.length)).toBe(1);
  await page.getByRole('button', { name:'取消', exact:true }).click();
  await page.evaluate(() => fixture.resolvePreview(0));
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => fixture.sent.length)).toBe(0);
  expect(await page.evaluate(() => fixture.error)).toBe('registration-aborted');
});
