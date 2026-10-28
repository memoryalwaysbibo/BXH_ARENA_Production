'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),presets=require('./emblem-presets.js');
test('six distinct system emblems accept only a safe color and known identity',()=>{
 assert.equal(presets.choices.length,6);assert.equal(new Set(presets.choices.map(x=>x.id)).size,6);
 for(const x of presets.choices){const svg=presets.render({id:x.id,color:'#12abEF'});assert.match(svg,/<svg/);assert.match(svg,/#12ABEF/);}
 for(const value of [{id:'other',color:'#123456'},{id:'shield',color:'red;display:none'},{id:'shield',color:'#123456',svg:'<script>'}])assert.throws(()=>presets.normalize(value),/invalid-emblem-preset/);
});
