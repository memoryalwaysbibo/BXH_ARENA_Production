'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'referee-score-v2.css'),'utf8');

assert(html.includes('referee-fault-core.js?v=14.2.38-fault-v1'),'fault core must be loaded with cache bust');
assert(html.includes('fault:1'),'fault score type must be canonical +1');
assert(html.includes('fault:"對手失誤＋1分"'),'fault score label missing');
assert(html.includes('function addFault(matchId, offendingSide)'),'fault action handler missing');
assert(html.includes('data-action="fault"'),'referee fault button missing');
assert(html.includes('失誤 ${count}/2'),'fault button must expose 0/2 or 1/2');
assert(html.includes('if(action==="fault")'),'fault click dispatch missing');
assert.equal((html.match(/"score","fault","undo-score"/g)||[]).length,5,'fault must share score permission and referee routing in all five action lists');
assert(html.includes('faultApi.attachSnapshotToEvent(m,hunterRoundEvent)'),'normal scoring must snapshot pending faults');
assert(html.includes('faultApi.clear(m)'),'normal scoring must clear current-round faults');
assert(html.includes('faultApi.restoreFromEvent(m,last)'),'undo must restore pre-score fault state');
assert(html.includes('m.faultActions=[]'),'rematch/round reset must clear faults');
assert(html.includes('undoAvailable=!!pendingFault||!!lastLog'),'undo must work for first fault before any score');
assert(html.includes('Array.isArray(m.faultActions)&&m.faultActions.length'),'pending fault must count as match activity');
assert(html.includes('referee-score-v2.css?v=14.2.38-score-fault'),'fault CSS must be cache-busted');
assert(css.includes('.fault-btn.has-fault'),'first-fault visual state missing');
assert(css.includes('再1次→對手+1'),'second-fault consequence hint missing');
assert(css.includes('.court-grid-4fit .side-panel .score-btns .fault-btn'),'four-court compact fault layout missing');

console.log('PASS referee fault rule UI wiring');
