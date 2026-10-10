'use strict';
(() => {
 const $ = id => document.getElementById(id);
 if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') {
  $('login').hidden = true;
  $('status').textContent = '請由本機隔離伺服器開啟這個頁面。'; return;
 }
 let token = '', cursor = null, filter = 'all', query = '', items = [], version = 0, controller;
 const messages = {401: '登入已失效，請重新登入測試帳號。', 403: '此測試帳號沒有讀取權限。',
  429: '讀取次數已達限制，請稍後手動重試。', 400: '查詢或資料版本已變動，請重新搜尋。',
  503: '資料暫時無法讀取，請檢查隔離環境。'};
 function status(message, error = false) { $('status').textContent = message; $('status').dataset.error = String(error); }
 function busy(value) {
  document.querySelectorAll('#review button:not(#logout), #login-button').forEach(x => x.disabled = value);
  $('items').setAttribute('aria-busy', String(value));
 }
 function clearList() {
  cursor = null; items = []; $('items').replaceChildren(); $('count').textContent = ''; $('next').hidden = true;
  ['p0', 'p1', 'p2'].forEach(id => $(id).textContent = '—');
 }
 function resetSession() {
  version++; controller?.abort(); token = ''; clearList(); filter = 'all'; query = '';
  $('search').value = ''; $('password').value = ''; $('email').value = '';
  document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.filter === filter)));
  $('login').hidden = false; $('review').hidden = true; busy(false);
 }
 async function post(url, body, signal) {
  const response = await fetch(url, {method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
   headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
   body: JSON.stringify(body), signal});
  if (!response.ok) throw Object.assign(Error('REQUEST_FAILED'), {status: response.status});
  return response.json();
 }
 function validate(result) {
  if (result?.access !== 'preview' || result.readOnly !== true || result.canApprove !== false || result.canPublish !== false ||
      result.sourceBatchId !== 'DATA-01B-20261009-ZHTW-TW05' || !Array.isArray(result.items) || result.items.length > 10 ||
      !result.summary || ['total', 'P0', 'P1', 'P2', 'visible'].some(k => !Number.isSafeInteger(result.summary[k]) || result.summary[k] < 0) ||
      (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !/^tw08:[a-f0-9]{20}:\d{1,6}$/.test(result.nextCursor))) ||
      result.items.some(x => !['P0', 'P1', 'P2'].includes(x.priority) || x.readOnly !== true || x.canApprove !== false || x.canPublish !== false || x.reviewState !== 'pending' ||
       ['queueId', 'recordId', 'section', 'reasonCode', 'details'].some(k => typeof x[k] !== 'string')))
   throw Error('UNSAFE_RESPONSE');
 }
 function node(tag, text, className) {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
 }
 function draw(result) {
  $('items').replaceChildren(...items.map(x => {
   const card = node('article', '', 'card');
   card.append(node('span', x.priority + ' · 待補證／審核', 'priority'), node('h2', x.details), node('p', x.recordId, 'record'));
   const details = document.createElement('details');
   details.append(node('summary', '查看待核原因'), node('p', x.reasonCode, 'record'), node('p', '資料類別：' + x.section, 'record'));
   card.append(details); return card;
  }));
  for (const p of ['P0', 'P1', 'P2']) $(p.toLowerCase()).textContent = result.summary[p];
  $('count').textContent = '本次條件顯示 ' + items.length + '／' + result.summary.visible + ' 項；全部待審 ' + result.summary.total + ' 項。';
  $('next').hidden = cursor === null;
  if (!items.length) $('items').append(node('p', '沒有符合條件的待審事項。', 'panel'));
 }
 async function read(append = false) {
  const current = ++version; controller?.abort(); controller = new AbortController();
  if (!append) clearList();
  busy(true); status('讀取中…');
  try {
   const result = await post('/api/review', {filter, query, limit: 10, cursor: append ? cursor : null}, controller.signal);
   if (current !== version) return;
   validate(result);
   const nextItems = append ? [...items, ...result.items] : result.items;
   if (new Set(nextItems.map(x => x.queueId)).size !== nextItems.length) throw Error('DUPLICATE_RESPONSE');
   items = nextItems; cursor = result.nextCursor; draw(result); status('已讀取；所有事項仍待審核。');
  } catch (error) {
   if (current !== version) return;
   if (error.status === 401) resetSession();
   else if (error.status === 403 || !error.status || error.status === 400 || error.status === 503) clearList();
   status(messages[error.status] || '讀取失敗，請稍後手動重試。', true);
  } finally {if (current === version) busy(false);}
 }
 $('login').addEventListener('submit', async event => {
  event.preventDefault(); const current = ++version; controller?.abort(); controller = new AbortController();
  token = ''; clearList(); busy(true); status('登入測試帳號中…');
  const credentials = {email: $('email').value.trim(), password: $('password').value}; $('password').value = '';
  try {
   const result = await post('/api/session', credentials, controller.signal);
   if (current !== version) return;
   if (typeof result.idToken !== 'string' || !/^[A-Za-z0-9._~-]{10,8192}$/.test(result.idToken)) throw Error('INVALID_SESSION');
   token = result.idToken; $('login').hidden = true; $('review').hidden = false; await read();
  } catch (error) {if (current === version) status(messages[error.status] || '測試登入失敗，請稍後重試。', true);}
  finally {credentials.password = ''; if (current === version) busy(false);}
 });
 $('logout').addEventListener('click', () => {resetSession(); status('已登出並清除本頁清單。'); $('email').focus();});
 $('search-form').addEventListener('submit', event => {event.preventDefault(); query = $('search').value.trim(); read();});
 document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter; query = $('search').value.trim();
  document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === button))); read();
 }));
 $('next').addEventListener('click', () => read(true));
 window.addEventListener('pagehide', resetSession);
})();
