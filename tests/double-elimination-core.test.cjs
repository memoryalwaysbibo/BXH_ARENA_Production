const test=require('node:test');
const assert=require('node:assert/strict');
const de=require('../double-elimination-core.js');

const bye=id=>({id,bracket:'WB',completed:true,isBye:true,winnerId:null,loserId:null});
const decided=(id,winnerId,loserId,extra={})=>({id,bracket:'WB',completed:true,isBye:false,winnerId,loserId,...extra});

test('two dead sources propagate as a structural void',()=>{
  const matches=[bye('w1'),bye('w2'),{id:'l1',bracket:'LB',completed:false,lbSrc:{type:'first',srcAId:'w1',srcBId:'w2'}}];
  const inputs=de.sourceInputs(matches,matches[2]);
  assert.deepEqual(inputs.map(x=>x.status),['dead','dead']);
  assert.equal(de.classifyInputs(inputs),'void');
});

test('one player and one dead source bypass, then stops at a real match',()=>{
  const matches=[
    decided('w1','A','P'),bye('w2'),
    {id:'l1',bracket:'LB',completed:false,lbSrc:{type:'first',srcAId:'w1',srcBId:'w2'}},
    decided('w3','C','B'),
    {id:'l2',bracket:'LB',completed:false,lbSrc:{type:'merge',survivorMatchId:'l1',dropperMatchId:'w3'}}
  ];
  assert.equal(de.classifyInputs(de.sourceInputs(matches,matches[2])),'bye');
  const finalInputs=de.sourceInputs(matches,matches[4]);
  assert.deepEqual(finalInputs.map(x=>x.playerId),['P','B']);
  assert.equal(de.classifyInputs(finalInputs),'play');
});

test('unfinished upstream remains waiting and is never treated as dead',()=>{
  const matches=[{id:'w1',bracket:'WB',completed:false},bye('w2'),{id:'l1',bracket:'LB',completed:false,lbSrc:{type:'first',srcAId:'w1',srcBId:'w2'}}];
  assert.equal(de.classifyInputs(de.sourceInputs(matches,matches[2])),'waiting');
});

test('schedule alternates winner and lower bracket phases',()=>{
  const matches=[
    {id:'wb0',bracket:'WB',round:0,indexInRound:0},
    {id:'wb1',bracket:'WB',round:1,indexInRound:0},
    {id:'wb2',bracket:'WB',round:2,indexInRound:0},
    {id:'lb0',bracket:'LB',round:0,indexInRound:0},
    {id:'lb1',bracket:'LB',round:1,indexInRound:0},
    {id:'lb2',bracket:'LB',round:2,indexInRound:0},
    {id:'lb3',bracket:'LB',round:3,indexInRound:0},
    {id:'gf',bracket:'GF',round:0,indexInRound:0}
  ];
  assert.deepEqual(de.resequence(matches).map(m=>m.id),['wb0','lb0','wb1','lb1','lb2','wb2','lb3','gf']);
});

test('third and fourth come from the final two lower-bracket eliminations',()=>{
  const matches=[
    {id:'lbSemi',bracket:'LB',completed:true,isBye:false,winnerId:'B',loserId:'D',seq:4},
    {id:'lbFinal',bracket:'LB',completed:true,isBye:false,winnerId:'B',loserId:'C',lbSrc:{type:'merge',survivorMatchId:'lbSemi',dropperMatchId:'wbFinal'},seq:6},
    {id:'wbFinal',bracket:'WB',completed:true,winnerId:'A',loserId:'C'},
    {id:'gf',bracket:'GF',gfSrc:{wbFinalId:'wbFinal',lbFinalId:'lbFinal'}}
  ];
  assert.deepEqual(de.placements(matches,'gf'),{thirdId:'C',fourthId:'D'});
});

test('three-player double elimination has a third but no fourth',()=>{
  const matches=[
    {id:'lbBye',bracket:'LB',completed:true,isBye:true,winnerId:'B',loserId:null},
    {id:'lbFinal',bracket:'LB',completed:true,isBye:false,winnerId:'B',loserId:'C',lbSrc:{type:'merge',survivorMatchId:'lbBye',dropperMatchId:'wbFinal'}},
    {id:'gf',bracket:'GF',gfSrc:{lbFinalId:'lbFinal'}}
  ];
  assert.deepEqual(de.placements(matches,'gf'),{thirdId:'C',fourthId:null});
});
