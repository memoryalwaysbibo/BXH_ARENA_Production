'use strict';
const fs=require('node:fs');
const src=fs.readFileSync('index.html','utf8');
function must(pattern,label){if(!pattern.test(src))throw new Error('Missing '+label);}
function mustContain(value,label){if(!src.includes(String(value)))throw new Error('Missing '+label);}
function mustNot(pattern,label){if(pattern.test(src))throw new Error('Unexpected '+label);}
must(/function tournamentOpsDefaultPrize\(\)/,'default prize helper');
must(/function operationsDraftPrizes\(d\)/,'prize draft normalizer');
must(/function renderOperationsPrizeDrafts\(d,disabled\)/,'multi-prize editor');
must(/data-action="ops-prize-add"/,'add prize item button');
must(/data-action="ops-prize-remove"/,'remove prize item button');
must(/data-action="ops-prize-inc"/,'increment prize quantity button');
must(/data-action="ops-prize-dec"/,'decrement prize quantity button');
must(/最多 20 個品項/,'20 item cap copy');
must(/合計最多 100 位得獎者/,'100 winner cap copy');
must(/renderTournamentRaffleRecord\(r,modes,statuses,locked\)/,'grouped prize history renderer');
must(/prizeIndex/,'prize-index aware history');
const release=require('../version.json');
mustContain(release.version,'release version');
must(new RegExp(require('../version.json').build.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'release build');
mustNot(/id="ops-title"/,'legacy single prize title field');
mustNot(/id="ops-count"/,'legacy single winner-count field');
console.log('PASS tournament operations multi-prize frontend');
