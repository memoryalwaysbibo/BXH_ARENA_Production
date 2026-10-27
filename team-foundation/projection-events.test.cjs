'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createProjectionEvents}=require('./projection-events.cjs');
function setup({on=true,refreshError=false}={}){const docs=new Map([['teamMembershipsV1/a',{teamId:'t'}],['teamsPublicV1/t',{members:['old']}]]),steps=[];
 const db={doc:path=>({path,get:async()=>({exists:docs.has(path),data:()=>docs.get(path)})}),runTransaction:async fn=>fn({get:async ref=>({exists:docs.has(ref.path)}),delete:ref=>{steps.push('invalidate');docs.delete(ref.path);}})};
 const events=createProjectionEvents({db,enabled:()=>on,refresh:async id=>{steps.push('refresh:'+id);if(refreshError)throw Error('source-unavailable');docs.set('teamsPublicV1/'+id,{members:['current']});return {status:'updated'};}});
 return {events,docs,steps};}
test('disabled events produce no reads or changes',async()=>{const f=setup({on:false});assert.deepEqual(await f.events.teamChanged({params:{teamId:'t'}}),{status:'disabled'});assert.deepEqual(f.steps,[]);});
test('event invalidates stale public roster and recomputes current data',async()=>{const f=setup();await f.events.teamChanged({params:{teamId:'t'},data:{after:{name:'stale'}}});assert.deepEqual(f.steps,['invalidate','refresh:t']);assert.deepEqual(f.docs.get('teamsPublicV1/t').members,['current']);await f.events.teamChanged({params:{teamId:'t'}});assert.deepEqual(f.docs.get('teamsPublicV1/t').members,['current']);});
test('failure leaves public projection unavailable and propagates for retry',async()=>{const f=setup({refreshError:true});await assert.rejects(f.events.playerChanged({params:{uid:'a'}}),/source-unavailable/);assert.equal(f.docs.has('teamsPublicV1/t'),false);});
test('players without a current team are ignored',async()=>{const f=setup();assert.deepEqual(await f.events.playerChanged({params:{uid:'x'}}),{status:'not-a-member'});assert.deepEqual(f.steps,[]);});
