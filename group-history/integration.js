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
  function paint(model) { if (current(model)) model.node.innerHTML = view().content(model); }
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
