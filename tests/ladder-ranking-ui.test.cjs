'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','ladder-secondary-ui.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','modules','main-app','core.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','modules','cloud','cloud-runtime.js'),'utf8');

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
assert(html.includes("'諸神典藏者':'assets/title-limited-gods-collector.webp'"), 'Gods Collector artwork must support its production Rare rarity');
for(const [name,file] of [['整裝待發','title-common-ready.svg'],['初次上陣','title-common-debut.svg']]){
  assert(html.includes("'"+name+"':'assets/"+file+"'"), name+' artwork missing from title catalog');
  assert(source.includes("\""+name+"\":\"assets/"+file+"\""), name+' artwork missing from ladder');
  assert(fs.existsSync(path.join(__dirname,'..','assets',file)), name+' artwork asset missing');
}
for(const [name,file] of [['百戰磨練','title-epic-hundred-battles.webp'],['四強霸主','title-epic-top4-overlord.webp'],['冠軍獵人','title-epic-champion-hunter.webp'],['百日戰士','title-epic-hundred-day-warrior.webp'],['初次開局','title-rare-first-match.webp'],['資深主辦','title-rare-host-20.webp'],['賽事推手','title-rare-host-10.webp'],['競技場主','title-rare-host-30.webp'],['封測先鋒','title-limited-closed-beta.webp']]){
  assert(html.includes("'"+name+"':'assets/"+file+"'"), name+' artwork missing from title catalog');
  assert(source.includes('"'+name+'":"assets/'+file+'"'), name+' artwork missing from ladder');
  assert(fs.existsSync(path.join(__dirname,'..','assets',file)), name+' artwork asset missing');
  assert(fs.existsSync(path.join(__dirname,'..','assets',file.replace(/\.webp$/,'.png'))), name+' PNG fallback missing');
}
assert(source.includes('String(row&&row.seasonId||"")===String(currentSeason)'), 'recent history must be isolated to the current season');
assert(source.includes('舊賽季已封存，不會載入玩家手機'), 'history archive boundary disclosure missing');
assert(html.includes('fx.orderBy("createdAt","desc")'), 'history query must be ordered on the server');
assert(html.includes('fx.limit(200)'), 'history query must be bounded before download');
assert(html.includes('ladder-secondary-ui.js?v=14.3.15'), 'ladder asset cache-bust version must match release');

console.log('PASS ladder ranking v2 layout / season-career modes');
