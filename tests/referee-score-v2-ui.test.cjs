'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'referee-score-v2.css'),'utf8');

assert(html.includes('referee-score-v2.css?v=14.2.38-score-fault'),'V2 stylesheet is not cache-busted into Production');
assert(html.includes('class="btn-row ref-result-actions"'),'result action layout hook missing');
assert(html.includes('class="btn btn-ghost ref-undo-score" data-action="undo-score"'),'undo action hook or handler changed');
assert(html.includes('class="btn btn-ghost ref-rematch" data-action="rematch"'),'rematch action hook or handler changed');
assert(html.includes('class="btn btn-primary ref-confirm-result" data-action="confirm-result"'),'confirm action hook or handler changed');
assert(html.includes('data-action="score"')&&html.includes('data-type="${type}"'),'score action contract must remain data-driven');
assert(html.includes('data-action="referee-swap-view"'),'referee view swap action must remain intact');

assert(css.includes('.court-grid:not(.court-grid-4fit) .referee-workstation'),'V2 must exclude four-court compact grid');
assert(css.includes('.side-panel .score-btns button[data-type="spin"]::before'),'spin score icon missing');
assert(css.includes('.side-panel .score-btns button[data-type="knockout"]::before'),'knockout score icon missing');
assert(css.includes('.side-panel .score-btns button[data-type="burst"]::before'),'burst score icon missing');
assert(css.includes('.side-panel .score-btns button[data-type="extreme"]::before'),'extreme score icon missing');
assert(css.includes('.ref-result-actions .ref-undo-score'),'undo full-row visual missing');
assert(css.includes('.ref-result-actions .ref-confirm-result'),'primary confirm CTA visual missing');
assert(css.includes('@media(max-width:640px)'),'mobile referee tuning missing');

function cssBlock(marker){
  const start=css.indexOf(marker);
  assert(start>=0,'missing CSS control marker: '+marker);
  const open=css.indexOf('{',start),close=css.indexOf('}',open);
  assert(open>start&&close>open,'malformed CSS control block: '+marker);
  return css.slice(open+1,close);
}
for(const marker of [
  '.score-btns button{',
  '.ref-vs-mark .ref-swap{',
  '.ref-result-actions .ref-undo-score{',
  '.ref-result-actions .ref-rematch{',
  '.ref-result-actions .ref-confirm-result{',
  '.match-status-controls .msc-btns .btn{'
]){
  const block=cssBlock(marker);
  assert(!block.includes('pointer-events:none'),'V2 must not disable referee control: '+marker);
  assert(!block.includes('display:none'),'V2 must not hide referee control: '+marker);
}

console.log('PASS referee score panel V2 visual-only guards');
