'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','ranked-registration-preopen-ui.js'),'utf8');
let registrationStatus='scheduled';
const listeners={};
const context={
  console,
  Date,
  setTimeout,clearTimeout,setInterval,clearInterval,
  document:{
    readyState:'loading',
    hidden:false,
    addEventListener(name,fn){listeners['document:'+name]=fn;}
  },
  window:{
    addEventListener(name,fn){listeners['window:'+name]=fn;}
  },
  getEffectiveRegistrationStatus(){return registrationStatus;},
  roomStatusDescriptor(key){return key==='registration'?{key:'registration',label:'報名中',dot:'green'}:{key,label:key,dot:'gray'};},
  normalizeDateTime(v){return v;}
};
vm.createContext(context);
vm.runInContext(source,context);
const api=context.window.BxhRankedRegistrationPreopen;
assert(api,'preopen API should be exposed');

const open=Date.parse('2026-09-26T13:30:00+08:00');
const ranked={ladderMode:'ranked',testLadderEnabled:false,registrationOpenAt:'2026-09-26T13:30:00+08:00'};
const general={ladderMode:'off',registrationOpenAt:ranked.registrationOpenAt};
const testRanked={ladderMode:'ranked',testLadderEnabled:true,registrationOpenAt:ranked.registrationOpenAt};

assert.equal(api.PREOPEN_MS,5*60*1000);
assert.equal(api.rankedEvent(ranked),true);
assert.equal(api.rankedEvent(general),false);
assert.equal(api.rankedEvent(testRanked),false);

assert.equal(api.isPreopenWindow(ranked,open-5*60*1000-1),false,'must stay waiting before T-5');
assert.equal(api.isPreopenWindow(ranked,open-5*60*1000),true,'must enter registration section exactly at T-5');
assert.equal(api.isPreopenWindow(ranked,open-1),true,'must remain preopen until T0');
assert.equal(api.isPreopenWindow(ranked,open),false,'preopen decoration stops at registration open time');
assert.equal(api.isPreopenWindow(general,open-60*1000),false,'general rooms are unchanged');

registrationStatus='closed';
assert.equal(api.isPreopenWindow(ranked,open-60*1000),false,'closed registration must not be promoted');
registrationStatus='scheduled';

const base={key:'prestart',label:'等待開始',dot:'gray',phase:'waiting'};
const decorated=api.decorateLifecycle(ranked,base,open-60*1000);
assert.equal(decorated.key,'registration');
assert.equal(decorated.phase,'waiting','canonical tournament phase must remain waiting');
assert.equal(decorated.preopen,true);
assert.equal(api.decorateLifecycle(general,base,open-60*1000),base);

const next=api.nextBoundary([ranked,general],open-10*60*1000);
assert.equal(next,open-5*60*1000,'nearest local transition should be the T-5 boundary');
const nextAtPreopen=api.nextBoundary([ranked],open-4*60*1000);
assert.equal(nextAtPreopen,open,'after T-5 the next transition should be T0');

assert(!/getEffectiveRegistrationStatus\s*=(?!=)/.test(source),'preopen module must never replace registration eligibility');
assert(!/registrationStatus\s*=\s*['"]open['"]/.test(source),'preopen module must never force registration open');

console.log('PASS ranked registration T-5 preopen UX');
