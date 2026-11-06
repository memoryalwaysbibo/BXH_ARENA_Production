'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReviewMobileModel}=require('../modules/bey-catalog/catalog-tw07-mobile-model.cjs');
const fixture={productionWritable:false,autoPublish:false,summary:{total:3,P0:1,P1:1,P2:1},
 items:[
 {queueId:'q1',recordId:'group_000007',section:'assemblyClaims',priority:'P0',reasonCode:'ORIGINAL_COMPOSITION_PENDING',details:'原配內容待核',reviewState:'pending'},
 {queueId:'q2',recordId:'part_000034',section:'parts',priority:'P1',reasonCode:'TAIWAN_PART_NAME_PENDING',details:'Brush 台灣名稱待核',reviewState:'pending'},
 {queueId:'q3',recordId:'variant_000010',section:'variants',priority:'P2',reasonCode:'PHYSICAL_COLOR_PENDING',details:'配色待確認',reviewState:'pending'}]};
test('guest/player cannot view review queue',()=>{
 for(const role of ['guest','player','staff']){const m=createReviewMobileModel(fixture,{viewerRole:role});assert.equal(m.access,'denied');assert.equal(m.visibleItems.length,0);}
});
test('admin preview can filter and search but never approve or publish',()=>{
 const m=createReviewMobileModel(fixture,{viewerRole:'admin',filter:'P1',query:'Brush'});
 assert.equal(m.access,'preview');assert.equal(m.visibleItems.length,1);assert.equal(m.visibleItems[0].recordId,'part_000034');
 assert.equal(m.readOnly,true);assert.equal(m.canApprove,false);assert.equal(m.canPublish,false);
 assert(m.visibleItems.every(x=>x.readOnly&&!x.canApprove&&!x.canPublish));
});
test('super-admin sees priority ordering, original queue remains immutable',()=>{
 const original=JSON.stringify(fixture),m=createReviewMobileModel(fixture,{viewerRole:'super_admin'});
 assert.deepEqual(m.visibleItems.map(x=>x.priority),['P0','P1','P2']);
 assert.equal(m.summary.total,3);assert.equal(m.summary.visible,3);
 assert.equal(JSON.stringify(fixture),original);
});
test('production writable data and invalid filter fail closed',()=>{
 assert.throws(()=>createReviewMobileModel({...fixture,productionWritable:true},{viewerRole:'admin'}),/TW07_RESEARCH_QUEUE_REQUIRED/);
 assert.throws(()=>createReviewMobileModel(fixture,{viewerRole:'admin',filter:'approved'}),/TW07_FILTER_INVALID/);
});
