'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {capacityAfter}=require('./team-capacity.cjs');
test('cap accepts the 200th team and denies another until a slot is released',()=>{assert.equal(capacityAfter(199,1),200);assert.throws(()=>capacityAfter(200,1),/team-capacity-full/);assert.equal(capacityAfter(200,-1),199);});
test('missing or inconsistent counter fails closed',()=>{for(const value of [undefined,-1,201,1.5])assert.throws(()=>capacityAfter(value,1),/team-capacity-unavailable/);assert.throws(()=>capacityAfter(0,-1),/team-capacity-unavailable/);});
