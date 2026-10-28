'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {resolveEmblemBucket}=require('./emblem-bucket.cjs');
test('emblem bucket must be explicitly configured for the current Firebase project',()=>{
 for(const bucket of ['test-project.firebasestorage.app','test-project.appspot.com'])assert.equal(resolveEmblemBucket({projectId:'test-project',bucket}),bucket);
 for(const bucket of [undefined,'','bxh-arena.firebasestorage.app'])assert.throws(()=>resolveEmblemBucket({projectId:'test-project',bucket}),/unconfigured/);
 assert.throws(()=>resolveEmblemBucket({projectId:undefined,bucket:'bxh-arena.firebasestorage.app'}),/unconfigured/);
});
