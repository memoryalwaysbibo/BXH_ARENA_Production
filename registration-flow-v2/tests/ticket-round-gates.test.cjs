'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {ticketRoundBlocked,ticketBronzeBlocked}=require('../backend/lifecycle.cjs');

function match(id,round,extra={}){
 return {id,bracket:'SE',round,status:'ready',completed:false,isBye:false,...extra};
}

test('PTN local gates match the current referee engine on round and bronze cases',()=>{
 const cases=[
  {matches:[match('final',0)],meta:{formatType:'single'}},
  {matches:[match('first',0),match('second',1)],meta:{formatType:'single'}},
  {matches:[match('first',0,{status:'in_progress'}),match('second',1)],meta:{formatType:'single'}},
  {matches:[match('first',0,{completed:true}),match('second',1)],meta:{formatType:'single'}},
  {matches:[match('first',0,{status:'in_progress',skippedAt:1}),match('second',1)],meta:{formatType:'single'}},
  {matches:[match('first',0),match('second',1)],meta:{formatType:'double'}},
  {matches:[match('semiA',0,{completed:true,loserId:'a'}),match('semiB',0,{completed:true,loserId:'b'}),match('final',1)],meta:{formatType:'single',bronzeMatch:true}},
  {matches:[match('semiA',0,{completed:true,loserId:'a'}),match('semiB',0,{completed:true,loserId:'b'}),match('final',1),match('bronze',1,{bracket:'BZ',completed:true})],meta:{formatType:'single',bronzeMatch:true}},
 ];
 for(const {matches,meta} of cases){
  const state={matches,meta};
  const engine=createEngine(state,{uid:'test'},1,'test');
  for(const item of matches){
   assert.equal(ticketRoundBlocked(item,matches,meta),
    engine.singleElimRoundDispatchBlocked(item,matches,meta),item.id);
   assert.equal(ticketBronzeBlocked(item,matches,meta),
    engine.singleElimBronzeBeforeFinalBlocked(item,matches,meta),item.id);
  }
 }
});
