'use strict';
const fs=require('node:fs');
const src=fs.readFileSync('index.html','utf8');

function must(pattern,label){
  if(!pattern.test(src))throw new Error('Missing '+label);
}
function mustNot(pattern,label){
  if(pattern.test(src))throw new Error('Unexpected '+label);
}

must(/function tournamentOpsDefaultPrize\(\)/,'default prize factory');
must(/prizes:\[tournamentOpsDefaultPrize\(\)\]/,'multi-prize draft');
must(/data-action="ops-prize-add"/,'add prize item action');
must(/data-action="ops-prize-remove"/,'remove prize item action');
must(/data-action="ops-prize-inc"/,'increase item quantity');
must(/data-action="ops-prize-dec"/,'decrease item quantity');
must(/prizes\.length>=20/,'20 item cap');
must(/operationsPrizeTotal\(d\)/,'total winner summary');
must(/同一次抽獎合計最多 100 位得獎者/,'100 winner cap copy');
must(/payload=\{code,mode:o\.draft\.mode,excludePrevious:o\.draft\.excludePrevious,prizes,operationId:/,'multi-prize draw payload');
must(/renderTournamentRaffleRecord\(r,modes,statuses,locked\)/,'grouped raffle history');
must(/prizeIndex/,'prize grouped winner rendering');
must(/const APP_VERSION = "v14\.2\.40"/,'release version');
must(/bxh-build" content="20260926\.13"/,'release build');
mustNot(/id="ops-title"/,'legacy single prize name field');
mustNot(/id="ops-description"/,'legacy single prize description field');
mustNot(/id="ops-count"/,'legacy single winner count field');

console.log('PASS tournament operations multi-prize UI');
