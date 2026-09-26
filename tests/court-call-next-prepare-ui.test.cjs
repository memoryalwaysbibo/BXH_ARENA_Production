'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','court-call-ui.js'),'utf8');

assert(source.includes('class="court-call-next-compact"'), 'compact next-match card missing');
assert(source.includes('class="court-call-next-compact-badge">下一場'), 'compact next-match badge missing');
assert(source.includes('court-call-next-compact-player'), 'compact next-match player row missing');
assert(source.includes('data-bxh-next-prepare="1"'), 'compact prepare marker missing');
assert(source.includes("linked?'尚未通知':'無法推播'"), 'compact prepare status missing');
assert(source.includes("prepare?'🔔 再次通知':'🔔 通知準備'"), 'compact prepare action labels missing');
assert(source.includes('${renderCourtCallNextPrepare(m,c)}'), 'referee call panel must render compact next-match card inline');
assert(!source.includes('function syncCourtCallNextPrepareInline'), 'DOM injection into bottom next-match card must stay removed');
assert(!source.includes("host.querySelector('.live-court-next')"), 'prepare action must not depend on bottom next-match card');
assert(!source.includes('class="court-call-next-ready"'), 'legacy duplicate next-match prepare card must stay removed');
assert(!source.includes('court-call-next-people'), 'legacy duplicate player boxes must stay removed');
assert(!source.includes('只提醒下一場選手先到戰鬥台附近準備'), 'legacy explanatory block must stay removed');

console.log('PASS compact top next-match prepare UI');
