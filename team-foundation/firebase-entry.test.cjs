'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createTeamCallable}=require('./firebase-entry.cjs');
test('Callable registration pins region and App Check and defaults to disabled',async()=>{
 let options;class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const fn=createTeamCallable({db:{},auth:{},HttpsError,onCall:(o,h)=>{options=o;return h;}});
 assert.deepEqual(options,{region:'asia-east1',enforceAppCheck:true,timeoutSeconds:30,maxInstances:5});
 await assert.rejects(fn({}),error=>error.code==='failed-precondition'&&error.message==='teams-unavailable');
});
