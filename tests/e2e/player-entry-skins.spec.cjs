const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Use the production render functions and the entry-related styles in document order.
// The full app stylesheets include unrelated screens and exhaust WebKit's test renderer.
const entryStyles = /^(?:modules\/main-css\/(?:auth-player|lobby-community|player-center-hunter|player-entry-skins)\.css|modules\/mobile-overrides\/styles\.css|client-entrance-theme\.css|modules\/theme-[^/]+\/styles\.css)$/;
const styles = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"?]+)/g)]
  .map(match => match[1]).filter(file => entryStyles.test(file))
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const context = {
  LOGO_SRC:'', pendingRegistrationCode:'', APP_VERSION:'test', esc:String, window:{},
  renderModal:()=>'', renderCloudJoinModal:()=>'', renderEventEntryModal:()=>'',
  renderQrScannerModal:()=>'', renderSwitchTournamentModal:()=>''
};
vm.createContext(context);
for (const name of ['authShellOpen', 'authShellClose', 'authBrandHeader', 'renderPlayerHomeScreen']) {
  const start = core.indexOf('function ' + name + '(');
  const end = core.indexOf('\nfunction ', start + 10);
  let source = core.slice(start, end);
  if (name === 'authBrandHeader') source = source.split('/* ==== celebration')[0];
  vm.runInContext(source, context);
}
vm.runInContext(core.match(/const ROLE_ICON_(?:ADMIN|PLAYER|GUEST) = .*;/g).join('\n'), context);
const markup = context.renderPlayerHomeScreen();
const themes = {
  gold:null, 'three-gods':['翼','天','巨'], akatsuki:['恩','鼬','鮫'],
  hunter:['傑','犽','酷'], clow:['櫻','狼','知'], zeon:['薩','洲','比'],
  directive:['零','初','貳'], gundam:null
};
test.describe.configure({ mode:'default' });

for (const [theme, symbols] of Object.entries(themes)) {
  test(`player entry ${theme}: action mapping and unclipped text`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setContent(`<!doctype html><html data-bxh-theme="${theme}"><head><style>${styles}</style></head><body>${markup}</body></html>`);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
    for (const width of [320,390,430,960]) {
      await page.setViewportSize({ width, height:844 });
      await page.evaluate(()=>document.querySelectorAll('.role-card-cn,.role-card-en,.role-card-desc,.role-card-enter')
        .forEach(e=>e.style.removeProperty('font-size')));
      const cards = page.locator('.player-entry-cards>.role-card');
      await expect(cards).toHaveCount(3);
      if (symbols) {
        for (const [i, action] of ['apply','login','lookup'].entries()) {
          const card = page.locator(`[data-action="player-goto-${action}"]`);
          expect(await card.evaluate(e=>getComputedStyle(e,'::before').content)).toBe(`"${symbols[i]}"`);
        }
        const colors = await cards.evaluateAll(es=>es.map(e=>getComputedStyle(e).getPropertyValue('--entry-tone').trim()));
        expect(new Set(colors).size).toBe(3);
      }
      for (const scale of [1,2]) {
        if (scale === 2) await page.evaluate(()=>{
          document.querySelectorAll('.role-card-cn,.role-card-en,.role-card-desc,.role-card-enter').forEach(e=>{
            e.style.setProperty('font-size', `${parseFloat(getComputedStyle(e).fontSize)*2}px`, 'important');
          });
        });
        // Touch devices have no hover pointer; check focus there and hover on desktop.
        for (const action of ['apply','login','lookup']) {
          const card = page.locator(`[data-action="player-goto-${action}"]`);
          await card.focus();
          if (!test.info().project.use.hasTouch) await card.hover();
          const issues = await card.evaluate((e, hasSymbol)=>{
            const failures=[], box=e.getBoundingClientRect();
            const title=e.querySelector('.role-card-cn').getBoundingClientRect();
            const desc=e.querySelector('.role-card-desc').getBoundingClientRect();
            const enter=e.querySelector('.role-card-enter').getBoundingClientRect();
            for (const cls of ['role-card-cn','role-card-en','role-card-desc','role-card-enter']) {
              const child=e.querySelector('.'+cls);
              if (getComputedStyle(child).display==='none') continue;
              const range=document.createRange();range.selectNodeContents(child);
              const r=range.getBoundingClientRect();
              if(r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1) failures.push(cls+' clipped');
            }
            if(desc.bottom>enter.top+1)failures.push('description overlaps CTA');
            if(hasSymbol){
              const s=getComputedStyle(e,'::before');
              const symbolRight=box.left+parseFloat(getComputedStyle(e).paddingLeft)+parseFloat(s.width);
              if(symbolRight>Math.min(title.left,desc.left)+1)failures.push('symbol overlaps text');
            }
            if(e.scrollHeight>e.clientHeight+1)failures.push('card content overflow');
            return failures;
          }, Boolean(symbols));
          expect(issues, `${theme} ${width}px ${scale}x ${action}`).toEqual([]);
        }
        const footerReachable=await page.evaluate(()=>{
          const sc=document.querySelector('.auth-scroll');sc.scrollTop=sc.scrollHeight;
          return document.querySelector('.auth-links').getBoundingClientRect().bottom<=sc.getBoundingClientRect().bottom+1;
        });
        expect(footerReachable,`${theme} footer ${width}px ${scale}x`).toBe(true);
      }
    }
  });
}
