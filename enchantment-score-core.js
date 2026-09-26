/* BXH 附魔之戰｜純計分規則。只接收已確定的抽卡結果，不在裁判手機抽卡。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BXHEnchantmentScore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BASE=Object.freeze({spin:1,knockout:2,burst:2,extreme:3});
  const CARDS=Object.freeze({
    double_extreme:{name:'雙重極限',kind:'buff',type:'extreme',points:6},
    double_knockout:{name:'雙重擊飛',kind:'buff',type:'knockout',points:4},
    double_burst:{name:'雙重爆裂',kind:'buff',type:'burst',points:4},
    double_spin:{name:'雙重轉停',kind:'buff',type:'spin',points:2},
    boost_extreme:{name:'強化極限',kind:'buff',type:'extreme',points:4},
    boost_knockout:{name:'強化擊飛',kind:'buff',type:'knockout',points:3},
    boost_burst:{name:'強化爆裂',kind:'buff',type:'burst',points:3},
    weaken_extreme:{name:'極限弱化',kind:'guard',type:'extreme',points:2},
    weaken_knockout:{name:'擊飛弱化',kind:'guard',type:'knockout',points:1},
    weaken_burst:{name:'爆裂弱化',kind:'guard',type:'burst',points:1},
    weaken_spin:{name:'轉停弱化',kind:'guard',type:'spin',points:0},
    seal:{name:'附魔封印',kind:'seal'}
  });
  function resolve({type,winnerCardId,loserCardId}){
    if(!Object.hasOwn(BASE,type))return {ok:false,reason:'invalid-outcome'};
    const winner=CARDS[winnerCardId],loser=CARDS[loserCardId];
    if(!winner||!loser)return {ok:false,reason:'missing-or-invalid-card'};
    const original=BASE[type];
    const buff=winner.kind==='buff'&&winner.type===type&&loser.kind!=='seal';
    const guard=loser.kind==='guard'&&loser.type===type&&winner.kind!=='seal';
    if(buff&&guard)return {ok:false,reason:'priority-undecided',originalPoints:original,triggered:[winnerCardId,loserCardId]};
    const applied=buff?winnerCardId:guard?loserCardId:null;
    const points=buff?winner.points:guard?loser.points:original;
    return {ok:true,type,originalPoints:original,points,delta:points-original,appliedCardId:applied,
      sealedCardId:winner.kind==='seal'?loserCardId:loser.kind==='seal'?winnerCardId:null};
  }
  return Object.freeze({BASE,CARDS,resolve});
});
