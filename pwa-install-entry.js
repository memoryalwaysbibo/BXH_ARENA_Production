/* Optional, pre-login install entry. It never calls auth, render(), or navigation. */
(function () {
  'use strict';
  if (window.BXHInstallEntry) return;

  const CANONICAL_URL = 'https://arena.bxh.com.tw/';
  const displayMode = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let prompting = false;
  let installedThisSession = false;
  let dialog = null;
  let guideTrigger = null;
  let status = '';

  function standalone() {
    return displayMode.matches || navigator.standalone === true;
  }

  function platform() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return {
      ios,
      android: /Android/i.test(ua),
      embedded: /Line\/|Instagram|FBAN|FBAV|; wv\)/i.test(ua)
    };
  }

  function renderEntry() {
    if (standalone() || installedThisSession) return '';
    const mobile = platform().ios || platform().android;
    return `<div class="bxh-install-entry">
      <button type="button" class="bxh-install-button" data-bxh-install ${prompting ? 'disabled' : ''}>${mobile ? '📲 加入手機主畫面' : '📲 安裝 ARENA／加入桌面'}</button>
      <p class="bxh-install-hint">下次直接點桌面圖示，就能開啟 ARENA</p>
      <p class="bxh-install-status" role="status" aria-live="polite">${status}</p>
    </div>`;
  }

  function updateEntries() {
    document.querySelectorAll('.bxh-install-entry').forEach(entry => {
      entry.hidden = standalone() || installedThisSession;
      entry.querySelector('[data-bxh-install]').disabled = prompting;
      entry.querySelector('.bxh-install-status').textContent = status;
    });
  }

  function closeGuide() {
    if (!dialog) return;
    const trigger = guideTrigger;
    const oldDialog = dialog;
    dialog = null;
    guideTrigger = null;
    if (oldDialog.open && typeof oldDialog.close === 'function') oldDialog.close();
    oldDialog.remove();
    if (trigger?.isConnected && !standalone() && !installedThisSession) {
      trigger.focus({ preventScroll: true });
    }
  }

  function guideContent() {
    const device = platform();
    if (device.embedded) {
      const browser = device.ios ? 'Safari' : 'Chrome';
      return `<p>目前是 LINE、Instagram 或其他 App 的內建瀏覽器。請先用外部瀏覽器開啟 ARENA。</p>
        <ol><li>點 App 的「⋯」或分享選單，找「在${browser}開啟」或「以瀏覽器開啟」。</li>
        <li>若沒有這個選項，複製下方網址，自己開啟 ${browser} 並貼上。</li>
        <li>開啟後，再點「加入手機主畫面」並依提示操作。</li></ol>
        <p class="bxh-install-note">此按鈕無法替你自動切換 App；安裝仍需在瀏覽器內確認。</p>`;
    }
    if (device.ios) {
      return `<p>iPhone／iPad 需要透過瀏覽器選單加入，這裡不會直接安裝。</p>
        <ol><li>在 Safari 開啟下方 ARENA 網址。</li>
        <li>點「分享」按鈕（方框向上箭頭；部分版本需先開啟「⋯」）。</li>
        <li>選「加入主畫面」；若看不到，向下捲動分享選單或編輯動作。</li>
        <li>若出現「作為網頁 App 開啟」，保持開啟，再點「加入」。</li></ol>`;
    }
    if (device.android) {
      return `<p>目前瀏覽器沒有提供直接安裝提示，你仍可試試瀏覽器選單。</p>
        <ol><li>在 Chrome 開啟下方 ARENA 網址。</li>
        <li>點右上角「⋮」，找「安裝應用程式」或「加到主畫面」。</li>
        <li>依畫面指示確認；選單名稱會因瀏覽器與版本而不同。</li></ol>`;
    }
    return `<p>電腦可試試 Chrome／Edge 網址列的安裝圖示，或瀏覽器選單中的安裝功能；Mac Safari 可使用「檔案」→「加入 Dock」。</p>
      <p>想加入手機主畫面？請在手機 Safari／Chrome 開啟下方網址，再點「加入手機主畫面」。</p>`;
  }

  function openGuide(trigger) {
    if (dialog || !trigger.isConnected || standalone() || installedThisSession) return;
    guideTrigger = trigger;
    dialog = document.createElement('dialog');
    dialog.className = 'bxh-install-guide';
    dialog.setAttribute('aria-labelledby', 'bxh-install-guide-title');
    dialog.innerHTML = `<div class="bxh-install-guide-content">
      <div class="bxh-install-guide-heading"><h2 id="bxh-install-guide-title">將 ARENA 加入主畫面</h2>
        <button type="button" class="bxh-install-close" data-bxh-install-close aria-label="關閉安裝說明" autofocus>✕</button></div>
      ${guideContent()}
      <label class="bxh-install-url-label" for="bxh-install-url">ARENA 正式網址</label>
      <input id="bxh-install-url" class="bxh-install-url" type="url" readonly value="${CANONICAL_URL}">
      <button type="button" class="bxh-install-button" data-bxh-install-copy>複製 ARENA 網址</button>
      <p class="bxh-install-copy-status" role="status" aria-live="polite"></p>
      <p class="bxh-install-note">若已加入過，可直接使用原本的桌面圖示。瀏覽器不一定能偵測已安裝狀態。關閉說明即可繼續登入，已填資料不會因此清除。</p>
      <button type="button" class="bxh-install-button" data-bxh-install-close>稍後再說</button>
    </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeGuide(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) closeGuide();
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      // Older embedded browsers get an inline guide, never a broken blocking overlay.
      trigger.closest('.bxh-install-entry').appendChild(dialog);
      dialog.setAttribute('open', '');
      dialog.classList.add('bxh-install-guide-inline');
      dialog.querySelector('[data-bxh-install-close]').focus();
    }
  }

  async function requestInstall(trigger) {
    if (prompting || standalone() || installedThisSession) return;
    const device = platform();
    if (!installPrompt || device.ios || device.embedded) {
      openGuide(trigger);
      return;
    }
    const prompt = installPrompt;
    installPrompt = null; // Each event may only be prompted once, including after cancellation.
    prompting = true;
    status = '';
    updateEntries();
    try {
      // Keep prompt() in this user-click stack; no async work before browser confirmation.
      const result = await prompt.prompt();
      const choice = result || (prompt.userChoice ? await prompt.userChoice : null);
      status = choice?.outcome === 'accepted'
        ? '已送出安裝確認；完成後可從桌面圖示開啟。'
        : '已取消安裝，你可以繼續登入，或稍後再試。';
    } catch (_) {
      status = '目前無法開啟安裝提示，請參考瀏覽器操作說明。';
      openGuide(trigger);
    } finally {
      prompting = false;
      updateEntries();
    }
  }

  async function copyUrl(button) {
    const activeDialog = dialog;
    if (!activeDialog || button.disabled) return;
    button.disabled = true;
    const message = activeDialog.querySelector('.bxh-install-copy-status');
    try {
      await navigator.clipboard.writeText(CANONICAL_URL);
      if (dialog === activeDialog) message.textContent = '已複製，請貼到 Safari／Chrome 的網址列。';
    } catch (_) {
      if (dialog === activeDialog) {
        const field = activeDialog.querySelector('.bxh-install-url');
        field.focus();
        field.select();
        field.setSelectionRange(0, CANONICAL_URL.length);
        message.textContent = '請長按或手動選取上方網址，再選擇複製。';
      }
    } finally {
      button.disabled = false;
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (!standalone() && !installedThisSession) installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installedThisSession = true;
    installPrompt = null;
    closeGuide();
    updateEntries();
  });
  function displayChanged() {
    if (standalone()) { installPrompt = null; closeGuide(); }
    updateEntries();
  }
  if (displayMode.addEventListener) displayMode.addEventListener('change', displayChanged);
  else if (displayMode.addListener) displayMode.addListener(displayChanged);
  window.addEventListener('pageshow', displayChanged);
  window.addEventListener('popstate', closeGuide);
  window.addEventListener('pagehide', closeGuide);
  document.addEventListener('keydown', event => {
    if (dialog && event.key === 'Escape') { event.preventDefault(); closeGuide(); }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (button.hasAttribute('data-bxh-install')) requestInstall(button);
    else if (button.hasAttribute('data-bxh-install-close')) closeGuide();
    else if (button.hasAttribute('data-bxh-install-copy')) copyUrl(button);
  });
  function watchScreen() {
    const app = document.getElementById('app');
    if (app) new MutationObserver(() => {
      if (guideTrigger && !guideTrigger.isConnected) closeGuide();
    }).observe(app, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchScreen, { once: true });
  else watchScreen();
  window.BXHInstallEntry = Object.freeze({ renderEntry });
})();
