'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertLegacyScoringWritable}=require('../../referee-seats/functions/bucket-legacy-fence.cjs');

test('legacy callable accepts unchanged rooms and rejects every bucket manifest',()=>{
  assert.doesNotThrow(()=>assertLegacyScoringWritable({data:'{}'}));
  for(const scoreStorage of [null,{}, {status:'preparing'}, {status:'active'}, {status:'closed'}]) {
    assert.throws(()=>assertLegacyScoringWritable({scoreStorage}),/bucket-scoring-required/);
  }
});
