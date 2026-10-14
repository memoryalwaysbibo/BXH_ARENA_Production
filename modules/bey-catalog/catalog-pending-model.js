/* Provisional user-supplied inventory. Never imported into the verified catalog. */
'use strict';
(function(root) {
  const EXPECTED_SHA256 = 'a16e67dd3e00f61f06299c32be253fbbfde134fc25565484080e86bdbfac0d5f';
  const EXPECTED_BYTES = 49695;
  const DATA_URL = './data/bey-catalog-pending/pending-inventory.' + EXPECTED_SHA256 + '.json';
  const SERIES_COUNTS = Object.freeze({BX:85, UX:44, CX:43, BXG:74, BXH:18, BXC:14, BXA:7});
  const sourceLabel = '使用者提供清單，尚未核實';
  const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join(',') === keys.slice().sort().join(',');
  const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value);
  function validate(data) {
    const fail = () => {throw new Error('INVALID_PENDING_INVENTORY');};
    if (!exactKeys(data, ['schemaVersion','sourceLabel','taiwanReleaseStatus','entries','unresolved']) || data.schemaVersion !== 1 || data.sourceLabel !== sourceLabel || data.taiwanReleaseStatus !== 'unknown' || !Array.isArray(data.entries) || data.entries.length !== 285 || !Array.isArray(data.unresolved) || data.unresolved.length !== 1) fail();
    const ids = new Set(), counts = {};
    data.entries.forEach((row, index) => {
      if (!exactKeys(row, ['suppliedId','series','code','suppliedNameConfiguration']) || row.suppliedId !== 'supplied_20261014_' + String(index + 1).padStart(4, '0') || !Object.hasOwn(SERIES_COUNTS, row.series) || !safeText(row.suppliedNameConfiguration) || typeof row.code !== 'string' || !new RegExp('^' + row.series + '-[0-9]{2}(?:-[0-9]{2})?$').test(row.code) || ids.has(row.suppliedId)) fail();
      ids.add(row.suppliedId); counts[row.series] = (counts[row.series] || 0) + 1;
    });
    if (Object.entries(SERIES_COUNTS).some(([series,count]) => counts[series] !== count)) fail();
    const row = data.unresolved[0];
    if (!exactKeys(row, ['suppliedId','series','code','reason']) || row.suppliedId !== 'supplied_20261014_0286' || row.series !== 'BXA' || row.code !== 'BXA-' || row.reason !== '型號及名稱不足，等待補充') fail();
    return data;
  }
  async function decodeSnapshot(buffer, cryptoProvider = globalThis.crypto) {
    if (!cryptoProvider?.subtle) throw new Error('SECURE_CONTEXT_REQUIRED');
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== EXPECTED_BYTES) throw new Error('PENDING_VERSION_MISMATCH');
    const hash = Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2,'0')).join('');
    if (hash !== EXPECTED_SHA256) throw new Error('PENDING_VERSION_MISMATCH');
    return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)));
  }
  const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/[\s‐‑–—−]/g, '').slice(0,240);
  function filter(data, query = '', series = 'all') {
    const needle = normalize(query);
    return data.entries.filter(row => (series === 'all' || row.series === series) && normalize(row.code + ' ' + row.suppliedNameConfiguration).includes(needle));
  }
  const api = Object.freeze({EXPECTED_SHA256,EXPECTED_BYTES,DATA_URL,SERIES_COUNTS,sourceLabel,validate,decodeSnapshot,filter});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BXHPendingInventory = api;
})(typeof window === 'object' ? window : globalThis);
