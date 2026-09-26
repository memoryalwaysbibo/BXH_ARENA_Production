'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','court-call-ui.js'),'utf8');

assert(source.includes('function syncCourtCallNextPrepareInline(m,c)'), 'inline next-match prepare sync missing');
assert(source.includes("host.querySelector('.live-court-next')"), 'prepare action must attach to existing next-match card');
assert(source.includes('data-bxh-next-prepare="1"'), 'inline prepare marker missing');
assert(source.includes("linked?'尚未通知':'無法推播｜有選手未綁定'"), 'compact prepare status missing');
assert(source.includes("prepare?'🔔 再次通知':'🔔 通知準備'"), 'compact prepare action labels missing');
assert(source.includes('queueCourtCallNextPrepareInline(m,c);'), 'referee render must queue inline prepare action');
assert(!source.includes('class="court-call-next-ready"'), 'legacy duplicate next-match prepare card must stay removed');
assert(!source.includes('court-call-next-people'), 'legacy duplicate player boxes must stay removed');
assert(!source.includes('只提醒下一場選手先到戰鬥台附近準備'), 'legacy explanatory block must stay removed');

console.log('PASS compact next-match prepare UI');
