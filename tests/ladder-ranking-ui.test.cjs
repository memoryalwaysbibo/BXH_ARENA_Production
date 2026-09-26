'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','ladder-secondary-ui.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

assert(source.includes('var ladderScoreMode="season";'), 'season mode must be the default');
assert(source.includes('data-ladder-score-mode="season"'), 'season score tab missing');
assert(source.includes('data-ladder-score-mode="career"'), 'career score tab missing');
assert(source.includes('function rankCareerRows(players)'), 'career ranking function missing');
assert(source.includes('Number(b&&b.careerPoints||0)-Number(a&&a.careerPoints||0)'), 'career points must drive career ranking');
assert(source.includes('ladderScoreMode==="career"?"careerPoints":"seasonPoints"'), 'score column must switch data source');
assert(source.includes('function ladderTierEmblemHtml(p)'), 'BXH tier emblem renderer missing');
assert(source.includes('ladder-tier-emblem is-legend')===false, 'legend class should be composed dynamically, not hardcoded');
assert(source.includes("tier.legend?' is-legend':''"), 'BXH legend emblem state missing');
assert(source.includes('class="ladder-player-block"'), 'player info block missing');
assert(source.includes('class="title-chip rarity-'), 'equipped title must remain under player name');
assert(source.includes('grid-template-columns:52px minmax(0,1fr) 96px 78px'), 'desktop/mobile-safe four-column grid missing');
assert(source.includes('grid-template-columns:44px minmax(0,1fr) 78px 64px'), 'narrow iPhone four-column grid missing');
assert(source.includes('title.textContent=(ladderScoreMode==="career"?"生涯":season+" 季賽")+"｜"+location;'), 'board title must reflect season/career mode');
assert(source.includes('grid-column:1/-1'), 'admin actions must be preserved without adding a fifth data column');
assert(html.includes('ladder-secondary-ui.js?v=14.2.39'), 'ladder asset cache-bust version must match release');

console.log('PASS ladder ranking v2 layout / season-career modes');
