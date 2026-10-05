const { test, expect } = require('@playwright/test');

// Exercise behavior with the app's supported reduced-motion preference. Keep ordinary
// actionability checks, while avoiding concurrent WebKit entrance-animation workloads.
test.use({ reducedMotion: 'reduce' });
test.describe.configure({ mode: 'default', timeout: 90000 });
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const error of testInfo.errors) console.error('INSTALL TEST FAILURE:', error.message);
  }
});

const ua = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
};

async function openLogin(page, userAgent = ua.android, setup = {}) {
  // These tests exercise the real local UI with every remote request blocked.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(({ userAgent, setup }) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
    Object.defineProperty(navigator, 'platform', { get: () => setup.ipad ? 'MacIntel' : 'test' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => setup.ipad ? 5 : 0 });
    if (setup.standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (setup.displayStandalone) {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, addEventListener() {} } : original(query);
    }
    if (setup.noDialog) HTMLDialogElement.prototype.showModal = undefined;
  }, { userAgent, setup });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="select-role-player"]').click();
  await expect(page.locator('[data-action="player-goto-login"]')).toBeVisible();
  await page.locator('[data-action="player-goto-login"]').click();
  await expect(page.locator('#player-login-email')).toBeVisible();
}

async function installEvent(page, mode = 'dismissed') {
  await page.evaluate(mode => {
    window.installCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => {
      window.installCalls++;
      if (mode === 'reject') return Promise.reject(new Error('not available'));
      if (mode === 'pending') return new Promise(resolve => { window.finishInstall = resolve; });
      return Promise.resolve({ outcome: mode });
    };
    window.dispatchEvent(event);
    window.installDefaultPrevented = event.defaultPrevented;
  }, mode);
}

const entry = page => page.locator('[data-bxh-install]');
const guide = page => page.locator('.bxh-install-guide');

test('optional entry is below login/signup, preserves input, focus and history on dismiss/reopen', async ({ page }) => {
  await openLogin(page);
  await expect(entry(page)).toHaveCount(1);
  await expect(entry(page)).toHaveText('📲 加入手機主畫面');
  await expect(guide(page)).toHaveCount(0);
  await page.locator('#player-login-email').fill('draft-player');
  await page.locator('#player-login-password').fill('draft-password');
  const before = await page.evaluate(() => ({ href: location.href, history: history.length }));
  await entry(page).click();
  await expect(guide(page)).toBeVisible();
  await expect(guide(page)).toContainText('安裝應用程式');
  await expect(page.getByRole('button', { name: '關閉安裝說明' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '稍後再說' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '關閉安裝說明' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
  await expect(page.locator('#player-login-password')).toHaveValue('draft-password');
  await expect(page.locator('#player-login-email')).toHaveValue('draft-player');
  expect(await page.evaluate(() => ({ href: location.href, history: history.length }))).toEqual(before);
  await entry(page).click();
  await page.evaluate(() => document.querySelector('[data-bxh-install]').click());
  await expect(guide(page)).toHaveCount(1);
  await page.getByRole('button', { name: '稍後再說' }).click();
  await entry(page).click();
  await page.mouse.click(2, 2);
  await expect(guide(page)).toHaveCount(0);
  await page.locator('[data-action="player-goto-apply"]').click();
  await page.locator('#apply-realname').fill('測試草稿');
  await page.locator('#apply-email').fill('draft@example.test');
  await page.locator('#apply-password').fill('draft-password');
  await page.locator('#apply-agree').check();
  await entry(page).click();
  await page.getByRole('button', { name: '關閉安裝說明' }).click();
  await expect(page.locator('#apply-realname')).toHaveValue('測試草稿');
  await expect(page.locator('#apply-email')).toHaveValue('draft@example.test');
  await expect(page.locator('#apply-password')).toHaveValue('draft-password');
  await expect(page.locator('#apply-agree')).toBeChecked();
});

test('native prompt occurs only on click, cancellation consumes once and repeated clicks stay safe', async ({ page }) => {
  await openLogin(page);
  await installEvent(page, 'pending');
  expect(await page.evaluate(() => installDefaultPrevented)).toBe(true);
  expect(await page.evaluate(() => installCalls)).toBe(0);
  await entry(page).click();
  await expect(entry(page)).toBeDisabled();
  await page.evaluate(() => document.querySelector('[data-bxh-install]').click());
  expect(await page.evaluate(() => installCalls)).toBe(1);
  await page.evaluate(() => finishInstall({ outcome: 'dismissed' }));
  await expect(entry(page)).toBeEnabled();
  await expect(page.locator('.bxh-install-status')).toContainText('已取消安裝');
  await expect(guide(page)).toHaveCount(0);
  await entry(page).click();
  await expect(guide(page)).toBeVisible();
  expect(await page.evaluate(() => installCalls)).toBe(1);
  await page.keyboard.press('Escape');
  await installEvent(page, 'accepted');
  await entry(page).click();
  await expect(page.locator('.bxh-install-status')).toContainText('已送出安裝確認');
  await expect(entry(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(entry(page)).toBeHidden();
});

test('native prompt rejection falls back to guide and never blocks login', async ({ page }) => {
  await openLogin(page);
  await installEvent(page, 'reject');
  await entry(page).click();
  await expect(guide(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entry(page)).toBeEnabled();
  await expect(page.locator('[data-action="player-email-signin"]')).toBeEnabled();
});

for (const browser of ['ios', 'ipad', 'line', 'instagram', 'desktop']) {
  test(`${browser} gets accurate instructions, canonical URL and safe clipboard fallback`, async ({ page }) => {
    const userAgent = browser === 'ios' ? ua.ios : browser === 'line' ? ua.ios + ' Line/15.0' : browser === 'instagram' ? ua.android + ' Instagram 300' : ua.desktop;
    await openLogin(page, userAgent, { ipad: browser === 'ipad' });
    await entry(page).click();
    await expect(guide(page)).toBeVisible();
    if (['ios', 'ipad'].includes(browser)) await expect(guide(page)).toContainText('分享');
    else if (['line', 'instagram'].includes(browser)) await expect(guide(page)).toContainText('無法替你自動切換 App');
    else await expect(guide(page)).toContainText('加入 Dock');
    await expect(page.locator('#bxh-install-url')).toHaveValue('https://arena.bxh.com.tw/');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('blocked'); } } }));
    await page.getByRole('button', { name: '複製 ARENA 網址' }).click();
    await expect(page.locator('.bxh-install-copy-status')).toContainText('手動選取');
    await expect(page.locator('#bxh-install-url')).toBeFocused();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedUrl = text; } } }));
    await page.getByRole('button', { name: '複製 ARENA 網址' }).click();
    await expect(page.locator('.bxh-install-copy-status')).toContainText('已複製');
    expect(await page.evaluate(() => copiedUrl)).toBe('https://arena.bxh.com.tw/');
    const dimensions = await guide(page).evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, right: el.getBoundingClientRect().right, viewport: innerWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
  });
}

for (const flag of ['standalone', 'displayStandalone']) {
  test(`installed ${flag} context hides entry without guessing browser-tab installation`, async ({ page }) => {
    await openLogin(page, ua.ios, { [flag]: true });
    await expect(entry(page)).toHaveCount(0);
    await expect(page.locator('[data-action="player-email-signin"]')).toBeVisible();
  });
}

test('older embedded browser has a dismissible inline guide; navigation removes stale guide', async ({ page }) => {
  await openLogin(page, ua.android + ' Instagram 300', { noDialog: true });
  await entry(page).click();
  await expect(page.locator('.bxh-install-guide-inline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toHaveCount(0);
  await entry(page).click();
  await page.locator('[data-action="player-goto-apply"]').click();
  await expect(guide(page)).toHaveCount(0);
  await expect(entry(page)).toHaveCount(1);
});

test('player entrance and administrator login each expose one optional entry', async ({ page }) => {
  await openLogin(page);
  await page.locator('[data-action="account-back-to-role"]').click();
  await page.locator('[data-action="select-role-player"]').click();
  await expect(entry(page)).toHaveCount(1);
  await page.locator('[data-action="account-back-to-role"]').click();
  await page.locator('[data-action="select-role-admin"]').click();
  await expect(entry(page)).toHaveCount(1);
  await expect(page.locator('#auth-username')).toBeVisible();
});

test('legacy userChoice cancellation and delayed failure after navigation are safe', async ({ page }) => {
  await openLogin(page);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await entry(page).click();
  await expect(page.locator('.bxh-install-status')).toContainText('已取消安裝');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => new Promise((resolve, reject) => { window.rejectInstall = reject; });
    window.dispatchEvent(event);
  });
  await entry(page).click();
  await page.locator('[data-action="player-goto-apply"]').click();
  await page.evaluate(() => rejectInstall(Error('late rejection')));
  await expect(guide(page)).toHaveCount(0);
  await expect(entry(page)).toBeEnabled();
});

test('late clipboard completion does not update a reopened guide; appinstalled closes it', async ({ page }) => {
  await openLogin(page);
  await entry(page).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.finishCopy = resolve; }) } }));
  await page.getByRole('button', { name: '複製 ARENA 網址' }).click();
  await page.keyboard.press('Escape');
  await entry(page).click();
  await page.evaluate(() => finishCopy());
  await expect(page.locator('.bxh-install-copy-status')).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(guide(page)).toHaveCount(0);
  await expect(entry(page)).toBeHidden();
});
