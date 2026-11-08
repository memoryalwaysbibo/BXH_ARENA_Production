'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchBootstrapStart}=require('../../../release/buckets/my-events/patch-bootstrap-start.cjs');
const source=readFileSync(path.join(__dirname,'deployed-bootstrap-start.cjs'),'utf8');
test('pinned operator bootstrap entrypoint passes the resolver to all three factories',()=>{
 assert.throws(()=>patchBootstrapStart(source+'\n'),/source-drift/);
 const out=patchBootstrapStart(source);
 assert.doesNotThrow(()=>new vm.Script(out));
 assert.match(out,/createEngine\(\{bridge,documentId,enabled:true,resolveRoomLifecycle\}\)/);
 assert.match(out,/createRebuilder\(\{bridge,engine,documentId,enabled:true,resolveRoomLifecycle\}\)/);
 assert.match(out,/createBootstrap\(\{bridge,rebuilder,documentId,enabled:true,resolveRoomLifecycle\}\)/);
 assert.match(out,/if\(!args.includes\('--execute'\)\)return \{status:'DRY_RUN'/);
});
