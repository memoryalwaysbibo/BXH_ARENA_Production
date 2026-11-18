'use strict';
// Test-only redirect: exercise the staged live-source overlay, never a deployed endpoint.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const repo=path.resolve(__dirname,'../..'),root=path.resolve(process.env.BXH_SCOPED_SOURCE_ROOT||''),stage=path.dirname(root);
assert(root.startsWith(path.join(repo,'test-results/score-stability-scoped')+path.sep),'scoped tests require the reviewed local stage');
assert(['commitBucketRefereeCommand','manageBucketRefereeSeats','projectBucketPublicScore'].includes(path.basename(root)));
const manifest=JSON.parse(fs.readFileSync(path.join(stage,'release-plan.json'),'utf8'));
for(const [file,digest] of Object.entries(manifest.functions[path.basename(root)].files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),digest.after,file);
const resolve=Module._resolveFilename,base=path.join(repo,'referee-seats/functions')+path.sep;
Module._resolveFilename=function(...args){const found=resolve.apply(this,args);if(found.startsWith(base)){const target=path.join(root,found.slice(base.length));assert(fs.existsSync(target),'staged runtime dependency missing: '+target);return target;}return found;};
