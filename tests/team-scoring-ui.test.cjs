'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');

assert(source.includes('雙命守擂計分板｜'));
assert(source.includes("'●'.repeat(life)+'○'.repeat(Math.max(0,2-life))"));
assert(source.includes("if(view.revealed&&state.startedAt){"));
assert(!source.includes("if(view.revealed&&state.startedAt&&view.isReferee===true){"));
assert(source.includes("'lineups-incomplete':'雙方尚未完成排陣"));
assert(source.includes('data-action="team-score-direct"'));
assert(source.includes('data-winner-side="'));
assert(source.includes("[['spin','轉停'],['burst','爆裂'],['over','擊飛'],['extreme','極限']]"));
assert(!source.includes('id="team-score-winner-'));
console.log('PASS team scoring board initial-state and error-message UI contracts');
