/* Independent, read-only pending list. Record strings only enter textContent. */
'use strict';
(() => {
  const model = window.BXHPendingInventory;
  const $ = id => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag); element.textContent = text || '';
    if (className) element.className = className;
    return element;
  };
  let data = null, loading = false, generation = 0;
  let candidates = new Map(), candidateLoading = false, candidateReady = false;
  function state(value, message) {
    $('pending-panel').dataset.state = value;
    $('pending-status').textContent = message;
    $('pending-controls').disabled = value !== 'ready';
    $('pending-results').setAttribute('aria-busy', String(value === 'loading'));
    $('pending-retry').hidden = value !== 'error';
  }
  function draw() {
    if (!data) return;
    const rows = model.filter(data, $('pending-search').value, $('pending-series').value);
    $('pending-results').replaceChildren(...rows.map(row => {
      const card = node('article', '', 'catalog-card pending-card'); card.dataset.suppliedId = row.suppliedId;
      const meta = node('div', '', 'card-meta');
      meta.append(node('span', row.code, 'product-code'), node('span', row.series + ' · 待核', 'category-tag'));
      card.append(meta, node('h3', row.suppliedNameConfiguration));
      card.append(node('p', '提供名稱與配置（尚未核實）', 'missing-note'));
      card.append(window.BXHCandidatePresentation ? window.BXHCandidatePresentation.createFigure(document,candidates.get(row.suppliedId)) : node('div', '圖片待補', 'pending-image-placeholder')); 
      card.append(node('p', '台灣官方名稱、上市狀態、圖片及規格：待核／待補', 'missing-note'));
      card.append(node('p', model.sourceLabel, 'pending-source'));
      if(window.BXHCandidatePresentation)card.append(window.BXHCandidatePresentation.createManualImageHandoff(document,row,candidates.get(row.suppliedId)));
      return card;
    }));
    if (!rows.length) $('pending-results').append(node('p', '沒有符合條件的待補項目。試試其他名稱、型號或配置，或清除篩選。', 'empty-state'));
    $('pending-count').textContent = '顯示 ' + rows.length + '／' + data.entries.length + ' 筆待補項目（保留提供順序）；另有 1 筆不完整項目。';
  }
  async function loadCandidates() {
    const policy = window.BXHCandidatePolicy, candidateModel = window.BXHCandidateImages;
    if (!policy || !candidateModel || !window.BXHCandidatePresentation || !data || candidateLoading || candidateReady) return;
    candidateLoading = true; $('candidate-retry').hidden = true;
    $('candidate-status').textContent = '正在檢查候選配圖版本…';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch(policy.dataURL,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      if (!response.ok) throw new Error('CANDIDATE_REQUEST_FAILED');
      const snapshot = await candidateModel.decodeSnapshot(await response.arrayBuffer(),policy);
      candidates = new Map(snapshot.entries.map(row => [row.recordId,row])); candidateReady = true; draw();
      $('candidate-status').textContent = '已配 ' + candidates.size + '／285 筆候選圖片，全部尚未核實；其餘保留待補。圖片核對不代表台灣上市狀態。';
    } catch (error) {
      candidates = new Map(); draw();
      $('candidate-status').textContent = '候選配圖暫時無法讀取或版本不符；清冊仍保留，圖片維持待補。'; $('candidate-retry').hidden = false;
    } finally {window.clearTimeout(timeout); candidateLoading = false;}
  }
  async function load() {
    if (loading || data) return;
    loading = true; const version = ++generation;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    state('loading', '正在讀取並檢查待補清冊版本…');
    try {
      if (!model) throw new Error('MODEL_UNAVAILABLE');
      const response = await fetch(model.DATA_URL, {method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      if (!response.ok) throw new Error('REQUEST_FAILED');
      const decoded = await model.decodeSnapshot(await response.arrayBuffer());
      if (version !== generation) return;
      data = decoded; draw(); state('ready', '已載入 285 筆待補項目；資料來源為使用者提供，尚未核實。');
      loadCandidates();
    } catch (error) {
      if (version !== generation) return;
      data = null; $('pending-results').replaceChildren(); $('pending-count').textContent = '';
      state('error', error.message === 'SECURE_CONTEXT_REQUIRED' ? '無法安全檢查清冊版本。請以支援安全驗證的瀏覽器，透過 HTTPS 或本機網址開啟。' : '待補清冊暫時無法讀取或版本不符，已停止顯示。請重新讀取。');
    } finally {window.clearTimeout(timeout); loading = false;}
  }
  function selectView(view, updateHistory) {
    const pending = view === 'pending';
    $('verified-panel').hidden = pending; $('pending-panel').hidden = !pending;
    document.querySelectorAll('[data-catalog-view]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.catalogView === 'pending') === pending)));
    $('catalog-skip').href = pending ? '#pending-controls' : '#catalog-controls';
    if (updateHistory) {
      const url = new URL(window.location.href);
      if (pending) url.searchParams.set('view','pending'); else url.searchParams.delete('view');
      if (url.href !== window.location.href) history.pushState(null,'',url);
    }
    if (pending) load();
  }
  document.querySelectorAll('[data-catalog-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.catalogView,true)));
  window.addEventListener('popstate', () => selectView(new URL(window.location.href).searchParams.get('view'),false));
  $('pending-search').addEventListener('input',draw);
  $('pending-series').addEventListener('change',draw);
  $('pending-reset').addEventListener('click', () => {$('pending-search').value = ''; $('pending-series').value = 'all'; draw(); $('pending-search').focus();});
  $('pending-retry').addEventListener('click',load);
  $('candidate-retry').addEventListener('click',loadCandidates);
  selectView(new URL(window.location.href).searchParams.get('view'),false);
})();
