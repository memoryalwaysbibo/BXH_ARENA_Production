const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('function normalizeHunterRoundEvent(');
const end=html.indexOf('function validateHunterRoundLedger(',start);
assert(start>0&&end>start);
const context={window:{BXHEnchantmentScore:require('../enchantment-score-core')},
 POINT_TYPES:{spin:1,knockout:2,burst:2,extreme:3,fault:1},
 HUNTER_VALID_POINT_TYPES:new Set(['spin','knockout','burst','extreme','fault']),
 HUNTER_ROUND_SCHEMA_VERSION:1};
vm.runInNewContext(html.slice(start,end),context);
const normalize=context.normalizeHunterRoundEvent;
const row={v:2,enchantment:true,eventId:'match1:e1',seq:1,round:1,side:'A',type:'burst',
 basePoints:2,points:1,delta:-1,appliedCardId:'weaken_burst',
 winningCardId:'double_burst',losingCardId:'weaken_burst',t:123};
test('v2 accepts defense-first scoring while standard v1 remains unchanged',()=>{
 const event=normalize(row,0,'match1');assert.equal(event.points,1);
 assert.equal(normalize({v:1,eventId:'old',seq:1,side:'A',type:'burst',points:2,t:123},0,'match1').points,2);
 assert.equal(normalize({...row,points:4},0,'match1'),null);
 assert.equal(normalize({...row,enchantment:false},0,'match1'),null);
});
test('v2 fault is fixed at one point regardless of cards',()=>{
 const fault={...row,type:'fault',basePoints:1,points:1,delta:0,appliedCardId:null};
 assert.equal(normalize(fault,0,'match1').points,1);
 assert.equal(normalize({...fault,points:2},0,'match1'),null);
});
