/* Referee certificate presentation helpers. All personal totals and awards come from the server. */
(function (root) {
  'use strict';
  const RANKS = Object.freeze([
    [1, '萌新裁判', 1, 0, 0, 0, '#40701D', '#85CE62'],
    [2, '青銅裁判', 20, 0, 0, 0, '#8B542F', '#C9956B'],
    [3, '白銀裁判', 50, 1, 0, 0, '#596775', '#C4CEDC'],
    [4, '黃金裁判', 100, 2, 1, 0, '#886300', '#EAC45A'],
    [5, '白金裁判', 200, 3, 2, 0, '#08766B', '#56D1BF'],
    [6, '鑽石裁判', 450, 4, 3, 0, '#2265A3', '#6BBAF5'],
    [7, '星耀裁判', 750, 6, 4, 1, '#7950B5', '#B79AFA'],
    [8, '王牌裁判', 1100, 8, 5, 2, '#BE2C4D', '#FF8298'],
    [9, '傳奇裁判', 1500, 10, 6, 3, '#A84910', '#FFAD61']
  ].map(([level, name, decisions, a, b, c, light, dark]) => Object.freeze({
    level, name, decisions, scales: Object.freeze({64: a, 96: b, 128: c}), light, dark
  })));
  const MILESTONES = Object.freeze(['百人', '兩百人', '三百人', '四百人', '五百人', '六百人', '七百人', '八百人', '九百人', '千人'].map((name, index) => Object.freeze({threshold: (index + 1) * 100, name: name + '賽事'})));
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const text = value => String(value == null ? '' : value);
  const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const number = value => count(value) === null ? '待確認' : value.toLocaleString('zh-TW');
  const photo = value => typeof value === 'string' && value.length <= 600000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';

  function date(value) {
    if (value && typeof value === 'object') value = Number(value._seconds ?? value.seconds) * 1000;
    if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
    if (!value) return '日期未記錄';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '日期待確認';
    return parsed.toLocaleDateString('zh-TW', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'});
  }
  function rank(level) { return RANKS.find(item => item.level === level) || null; }
  function progress(snapshot) {
    const awarded = count(snapshot?.certificate?.awardedLevel) ?? 0;
    const target = rank(awarded + 1);
    if (!target) return {target: null, fraction: 1, decisionGap: 0, gates: [], allMet: true};
    const stats = snapshot?.stats || {}, current = count(stats.decisions);
    const start = rank(awarded)?.decisions || 0;
    const fraction = current === null ? null : Math.max(0, Math.min(1, (current - start) / (target.decisions - start)));
    const gates = [64, 96, 128].map(size => ({size, required: target.scales[size], current: count(stats.scales?.[size])}));
    return {
      target, fraction, start, decisionGap: current === null ? null : Math.max(0, target.decisions - current),
      gates, allMet: current !== null && current >= target.decisions && gates.every(item => !item.required || item.current !== null && item.current >= item.required)
    };
  }
  function validateEntry(entry) {
    const errors = [];
    const decisions = count(entry?.decisions), events = count(entry?.events);
    if (decisions === null) errors.push('判決場數請填 0 或正整數。');
    if (events === null) errors.push('參與賽事次數請填 0 或正整數。');
    if (decisions > 1000000 || events > 1000000) errors.push('單筆回補數量最多 1,000,000。');
    if (decisions === 0 && events === 0) errors.push('請至少填入一項要回補的數量。');
    if (events !== null && events > 0) {
      if (!['exact', 'at_least', 'unknown'].includes(entry.precision)) errors.push('請選擇賽事規模的記憶方式。');
      if (entry.precision === 'unknown') {
        if (entry.size !== null) errors.push('規模未確認時，賽事人數請留空。');
      } else if (count(entry.size) === null || entry.size === 0 || entry.size > 1000000) errors.push('人數請填 1～1,000,000 的整數，或選擇規模未確認。');
    }
    if (!text(entry?.period).trim()) errors.push('請填寫涵蓋期間；記不清日期可填「系統開始記錄前」。');
    if (text(entry?.period).length > 100) errors.push('涵蓋期間請限制在 100 字內。');
    if (text(entry?.note).length > 500) errors.push('備註請限制在 500 字內。');
    return errors;
  }
  function entryScale(entry) {
    if (!entry?.events) return '未補登賽事經歷';
    if (entry.precision === 'unknown') return '規模未確認';
    return (entry.precision === 'at_least' ? '至少 ' : '') + number(entry.size) + ' 人';
  }
  function impact(snapshot, entry) {
    if (validateEntry(entry).length) return null;
    const stats = snapshot?.stats || {};
    const original = (snapshot?.backfills || []).find(item => item.id === entry.id && item.status === 'active');
    const values = {};
    for (const [key, next, before] of [['decisions', entry.decisions, original?.decisions || 0], ['eventCount', entry.events, original?.events || 0]]) {
      const current = count(stats[key]), after = current === null ? null : current - before + next;
      if (after !== null && (count(after) === null)) return null;
      values[key] = {current, after};
    }
    values.thresholds = [64, 96, 128, ...MILESTONES.map(item => item.threshold)].map(size => {
      const before = original?.precision !== 'unknown' && original?.size >= size ? original.events : 0;
      const after = entry.precision !== 'unknown' && entry.size >= size ? entry.events : 0;
      return {size, delta: after - before};
    }).filter(item => item.delta !== 0);
    return values;
  }
  root.BXHRefereeLicenseDomain = Object.freeze({RANKS, MILESTONES, count, escape, number, date, photo, rank, progress, validateEntry, entryScale, impact});
})(window);
