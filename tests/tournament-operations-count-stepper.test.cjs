'use strict';
const fs=require('node:fs');
const src=fs.readFileSync('raffle-ui.js','utf8');

function must(pattern,label){
  if(!pattern.test(src))throw new Error('Missing '+label);
}

must(/function enhanceOpsCountStepper\(\)/,'operations count stepper enhancer');
must(/getElementById\('ops-count'\)/,'ops-count binding');
must(/textContent='−'/,'decrement button');
must(/textContent='＋'/,'increment button');
must(/aria-label/,'accessible labels');
must(/Math\.min\(b\.max,Math\.max\(b\.min,normalized\(\)\+delta\)\)/,'1..100 clamp');
must(/dispatchEvent\(new Event\('input',\{bubbles:true\}\)\)/,'input event propagation');
must(/dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/,'change event propagation');
must(/enhanceOpsCountStepper\(\)/,'enhancer wired into render observer');

console.log('PASS tournament operations winner-count stepper');
