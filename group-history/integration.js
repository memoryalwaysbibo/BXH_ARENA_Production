(function (root) {
  'use strict';
  let active = null;
  let suspendedSession = null;
  const discoveryLimit = 8;
  const readTimeoutMs = 15000;
  const view = () => root.BXHGroupHistoryView;
  function current(model) {
    const session = model.getSession();
    const valid = active === model && model.node.isConnected && session?.uid === model.uid && session?.epoch === model.epoch &&
      (!model.getScope || model.getScope() === model.scope);
    if (!valid && active === model) resetSession();
    return valid;
  }
  function clear(model) {
    if (!model) return;
    model.requestId++;
    model.data = null;
    model.discovered = [];
    model.node.innerHTML = '';
    model.node.removeEventListener('click', model.click);
    model.node.removeEventListener('submit', model.submit);
    model.node.removeEventListener('input', model.inputChanged);
    model.node.removeEventListener('keydown', model.keydown);
  }
  function resetSession() { const old = active; active = null; clear(old); }
  function suspendSession(uid, epoch) { suspendedSession = { uid, epoch }; resetSession(); }
  function layoutTree(model) {
    if (!current(model) || model.mode !== 'preview') return;
    const tree = model.node.querySelector('.group-history-tree');
    if (!tree) return;
    tree.querySelector('.group-history-lines')?.remove();
    const columns = [...tree.querySelectorAll('.group-history-round[data-bracket="main"]')];
    if (!columns.length) return;
    const cards = columns.map(col => new Map([...col.querySelectorAll('.group-history-match')]
      .map(card => [Number(card.dataset.index), card])));
    const anchor = cards.reduce((best, map, index) => map.size > cards[best].size ? index : best, 0);
    const positions = cards.map(() => new Map());
    const rowHeight = Math.max(65, ...cards.flatMap(map => [...map.values()].map(card => card.offsetHeight))) + 10;
    let cursor = 0;
    for (const [index, card] of cards[anchor]) { positions[anchor].set(index, cursor + card.offsetHeight / 2); cursor += rowHeight; }
    for (let round = anchor + 1; round < cards.length; round++) {
      for (const [index, card] of cards[round]) {
        const a = positions[round - 1].get(index * 2), b = positions[round - 1].get(index * 2 + 1);
        positions[round].set(index, a != null && b != null ? (a + b) / 2 : (a ?? b ?? card.offsetHeight / 2));
      }
    }
    for (let round = anchor - 1; round >= 0; round--) {
      for (const [index, card] of cards[round]) {
        const sibling = cards[round].has(index ^ 1);
        const target = positions[round + 1].get(Math.floor(index / 2));
        positions[round].set(index, (target ?? card.offsetHeight / 2) + (sibling ? (index % 2 ? rowHeight / 2 : -rowHeight / 2) : 0));
      }
    }
    let height = 0;
    cards.forEach((map, round) => {
      const holder = columns[round].querySelector('.group-history-round-matches');
      let previous = 0;
      for (const [index, card] of map) {
        const top = Math.max(previous, (positions[round].get(index) || 0) - card.offsetHeight / 2);
        card.style.position = 'absolute'; card.style.top = top + 'px'; card.style.left = '0'; card.style.right = '0';
        positions[round].set(index, top + card.offsetHeight / 2);
        previous = top + card.offsetHeight + 5;
      }
      height = Math.max(height, previous);
      holder.style.minHeight = Math.ceil(Math.max(height, rowHeight)) + 'px';
    });
    columns.forEach(col => { col.querySelector('.group-history-round-matches').style.minHeight = Math.ceil(height) + 'px'; });
    // Lines only connect real matches. Hidden BYEs cannot create phantom branches.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('group-history-lines');
    svg.setAttribute('aria-hidden', 'true');
    tree.appendChild(svg);
    const origin = tree.getBoundingClientRect();
    const x = card => card.getBoundingClientRect().right - origin.left + tree.scrollLeft;
    const y = card => card.getBoundingClientRect().top - origin.top + card.offsetHeight / 2;
    for (let round = 1; round < cards.length; round++) {
      for (const [index, target] of cards[round]) {
        const sources = [cards[round - 1].get(index * 2), cards[round - 1].get(index * 2 + 1)].filter(Boolean);
        for (const source of sources) {
          const start = x(source), end = target.getBoundingClientRect().left - origin.left + tree.scrollLeft;
          const mid = (start + end) / 2;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${start} ${y(source)} H ${mid} V ${y(target)} H ${end}`);
          svg.appendChild(path);
        }
      }
    }
    svg.setAttribute('width', String(tree.scrollWidth)); svg.setAttribute('height', String(tree.scrollHeight));
  }
  function paint(model) {
    if (!current(model)) return;
    model.node.innerHTML = view().content(model);
    if (model.mode === 'preview' && typeof root.requestAnimationFrame === 'function')
      root.requestAnimationFrame(() => { if (current(model)) layoutTree(model); });
  }
  function errorText(error) {
    const code = String(error?.code || '') + ' ' + String(error?.message || '');
    if (/permission-denied|unauthenticated|auth-required/.test(code)) return '請確認登入帳號及此賽事的查閱權限。';
    if (/group-room-disabled|group-plan-required|group-parent-unavailable|not-found/.test(code)) return '尚無可查閱的分組賽紀錄，請確認主房代碼。';
    if (/history-timeout/.test(code)) return '讀取逾時，請稍後按更新紀錄重試。';
    return '分組賽紀錄暫時無法讀取，請稍後重試。';
  }
  function boundedRead(callback) {
    let timer;
    return Promise.race([Promise.resolve().then(callback), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('history-timeout')), readTimeoutMs);
    })]).finally(() => clearTimeout(timer));
  }
  async function load(model, code) {
    if (!current(model) || model.busy) return;
    code = String(code || '').trim().toUpperCase();
    if (!view().codeValid(code)) { model.error = '請輸入完整主房代碼，例如 BXH-ABC123。'; paint(model); return; }
    model.code = code; model.input = code; model.busy = true; model.started = true;
    model.data = null; model.error = '';
    const requestId = ++model.requestId;
    paint(model);
    try {
      const response = await boundedRead(() => {
        if (!current(model) || requestId !== model.requestId) throw new Error('history-cancelled');
        return model.request({ action: 'history', parentCode: code });
      });
      if (!current(model) || requestId !== model.requestId) return;
      if (response?.parent?.code !== code || !Array.isArray(response.stages) || !Array.isArray(response.ownPlayerIds)) throw new Error('history-invalid-response');
      model.data = response;
    } catch (error) {
      if (current(model) && requestId === model.requestId) model.error = errorText(error);
    } finally {
      if (current(model) && requestId === model.requestId) { model.busy = false; paint(model); }
    }
  }
  async function discover(model) {
    if (!current(model) || model.busy || !model.canDiscover) return;
    model.busy = true; model.error = ''; model.discovered = [];
    const requestId = ++model.requestId;
    paint(model);
    let failed = 0;
    for (const code of model.codes) {
      if (!current(model) || model.requestId !== requestId) return;
      try {
        const result = await boundedRead(() => {
          if (!current(model) || model.requestId !== requestId) throw new Error('history-cancelled');
          return model.mine({ action: 'mine', code });
        });
        if (!current(model) || model.requestId !== requestId) return;
        // Discovery only locates candidate rooms. Only the history endpoint resolves own identity.
        if (Array.isArray(result?.rows) && result.rows.some(row => row && row.status !== 'cancelled')) model.discovered.push(code);
      } catch (_) { failed++; }
    }
    if (!current(model) || model.requestId !== requestId) return;
    model.busy = false;
    model.error = failed ? '部分主房未能讀取，可直接輸入代碼查詢。' : model.discovered.length ? '' : '目前設定的主房中沒有找到報名紀錄，可直接輸入代碼查詢。';
    paint(model);
  }
  function bind(node, options = {}) {
    const session = options.getSession?.();
    if (!node || !session?.uid || suspendedSession?.uid === session.uid && suspendedSession?.epoch === session.epoch || !Number.isSafeInteger(session.epoch) || !view() || typeof options.request !== 'function') { resetSession(); return; }
    const mode = node.dataset.groupHistoryMode === 'own' ? 'own' : 'preview';
    const scope = typeof options.getScope === 'function' ? options.getScope() : options.scope || '';
    const key = [session.uid, session.epoch, scope, mode, node.dataset.code || ''].join(':');
    if (active?.node === node && active.key === key) return;
    const previous = active?.key === key && active.uid === session.uid && active.epoch === session.epoch ? active : null;
    // Re-rendered nodes keep only completed data within the exact session/view. Pending reads never retarget a replacement node.
    const saved = previous ? { data: previous.data, selected: previous.selected, code: previous.code, input: previous.input,
      started: previous.started, discovered: previous.discovered.slice(), error: previous.error } : {};
    resetSession();
    const codes = [...new Set(Array.isArray(options.parentCodes) ? options.parentCodes : [])].filter(view().codeValid).slice(0, discoveryLimit);
    const model = { key, node, uid: session.uid, epoch: session.epoch, getSession: options.getSession, getScope: options.getScope, scope, mode,
      code: node.dataset.code || '', input: node.dataset.code || '', selected: 'A', data: null, discovered: [], error: '',
      requestId: 0, busy: false, started: false, ...saved, request: options.request, mine: options.mine, codes,
      canDiscover: typeof options.mine === 'function' && codes.length > 0 };
    active = model;
    model.click = event => {
      if (!current(model)) return;
      const target = event.target.closest('button');
      if (!target || !node.contains(target) || target.disabled) return;
      const stage = target.dataset.groupHistoryStage;
      if (view().keys.includes(stage)) { model.selected = stage; paint(model); node.querySelector('[data-group-history-stage="' + stage + '"]')?.focus(); return; }
      if (target.dataset.groupHistoryCode) void load(model, target.dataset.groupHistoryCode);
      if (target.dataset.groupHistoryAction === 'refresh') void load(model, model.code);
      if (target.dataset.groupHistoryAction === 'discover') void discover(model);
    };
    model.submit = event => { if (event.target.matches('[data-group-history-search]')) { event.preventDefault(); void load(model, model.input); } };
    model.inputChanged = event => { if (current(model) && event.target.name === 'parentCode') model.input = event.target.value; };
    model.keydown = event => {
      const target = event.target.closest('[data-group-history-stage]');
      if (!current(model) || !target || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const keys = view().keys, index = keys.indexOf(model.selected);
      model.selected = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : keys[(index + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length];
      paint(model); node.querySelector('[data-group-history-stage="' + model.selected + '"]')?.focus();
    };
    node.addEventListener('click', model.click); node.addEventListener('submit', model.submit);
    node.addEventListener('input', model.inputChanged); node.addEventListener('keydown', model.keydown);
    paint(model);
    if (!model.data && (node.dataset.auto === 'true' || model.started) && view().codeValid(model.code)) void load(model, model.code);
  }
  root.addEventListener?.('pagehide', resetSession);
  root.BXHGroupHistory = { bind, resetSession, suspendSession, discoveryLimit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
