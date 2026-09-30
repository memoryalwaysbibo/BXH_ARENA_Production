'use strict';
const assert=require('node:assert/strict');
const core=require('../registration-reminder-core.js');

const open=Date.parse('2026-10-05T12:00:00+08:00');
const event={id:'evt-1',name:'美食盃門票戰',registrationOpenAt:open,url:'/?event=evt-1'};
const pref={uid:'u1',eventId:'evt-1',enabled:true,reminderMinutes:60,registrationOpenAt:open,sentForOpenAt:null};

assert.equal(core.eligibility(pref,event,open-61*60000).reason,'not-due');
const due=core.eligibility(pref,event,open-60*60000);
assert.equal(due.eligible,true);
assert.equal(due.dedupeKey,'registration-reminder:u1:evt-1:'+open+':60');
assert.equal(core.eligibility({...pref,sentForOpenAt:open},event,open-30*60000).reason,'already-sent');
assert.equal(core.eligibility({...pref,registrationOpenAt:open-1000},event,open-30*60000).reason,'stale-open-time');
assert.equal(core.eligibility(pref,event,open+5*60000+1).reason,'expired');
assert.equal(core.eligibility({...pref,enabled:false},event,open-60*60000).reason,'disabled');
assert.equal(core.eligibility({...pref,reminderMinutes:15},event,open-15*60000).reason,'invalid-reminder-minutes');

const changed={...event,registrationOpenAt:open+3600000};
assert.equal(core.eligibility(pref,changed,open).reason,'stale-open-time');
const refreshed={...pref,registrationOpenAt:changed.registrationOpenAt,sentForOpenAt:null};
assert.equal(core.eligibility(refreshed,changed,changed.registrationOpenAt-60*60000).eligible,true);

const p=core.payload(pref,event);
assert.equal(p.kind,'registration-reminder');
assert.equal(p.reminderMinutes,'60');
assert.match(p.body,/60 分鐘後開放報名/);

const immediate=core.payload({...pref,reminderMinutes:0},event);
assert.match(immediate.body,/已開放報名/);

console.log('registration reminder scheduler core: PASS');
