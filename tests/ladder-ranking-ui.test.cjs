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
assert(source.includes('assets/title-limited-gods-collector.webp'), 'Gods Collector artwork must render in the ladder');
assert(source.includes('grid-template-columns:64px minmax(0,1fr) 96px 78px'), 'desktop/mobile-safe four-column grid missing');
assert(source.includes('grid-template-columns:54px minmax(0,1fr) 78px 64px'), 'narrow iPhone four-column grid missing');
assert(source.includes('ladder-board-heading'), 'board title must display the active score mode and location');
assert(source.includes('grid-column:1/-1'), 'admin actions must be preserved without adding a fifth data column');
assert(source.includes('.ladder-rank-scroll-v2{max-height:none;overflow:visible;}'), 'ranking must grow beyond the shared 420px list limit');
assert(source.includes('assets/ladder-gods-trial-transparent.png'), 'transparent Gods trial badges must be used');
assert(source.includes('width:72px;height:72px;flex:0 0 72px'), 'desktop emblems must retain square proportions');
assert(source.includes('width:60px;height:60px;flex-basis:60px'), 'mobile emblems must retain square proportions');
assert(source.includes('.ladder-tier-emblem.is-legend{background-position:100% 100%'), 'legend must use the ninth badge');
assert(html.includes('function ladderBadgeHtml(p)'), 'shared tier badge renderer missing');
assert(html.includes('<div class="guest-tier">${ladderBadgeHtml(p)}</div>'), 'guest leaderboard must show tier badges');
assert(html.includes('<div class="guest-player-mobile-badge">${ladderBadgeHtml(p)}</div>'), 'mobile guest leaderboard must show tier badges');
assert(html.includes('class="value small profile-tier-badge">${ladderBadgeHtml(l)}'), 'player profile must show tier badge');
assert(html.includes("(rarity==='rare'||rarity==='limited')&&name==='諸神典藏者'"), 'Gods Collector artwork must support its production Rare rarity');
assert(html.includes('ladder-secondary-ui.js?v=14.2.52'), 'ladder asset cache-bust version must match release');

console.log('PASS ladder ranking v2 layout / season-career modes');
