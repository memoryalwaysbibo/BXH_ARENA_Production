'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync(require('node:path').join(__dirname,'../../modules/main-app/core.js'),'utf8');
const pick=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
const ctx={};vm.createContext(ctx);
vm.runInContext(pick('function titleConditionMeta(t){','function titleConditionBadge(t)')+'\n'+
  pick('function titleGalleryProgressText(t,got){',"let titleGalleryFilter="),ctx);
test('title gallery presents hours and explicitly says no daily time cap',()=>{
  const title={conditionType:'total_online_minutes',targetValue:600,progress:{currentValue:300}};
  assert.equal(ctx.titleGalleryProgressText(title,false),'5／10 小時');
  assert.equal(ctx.titleGalleryProgressText(title,true),'✓ 已取得');
  assert.equal(ctx.titleConditionMeta(title).task,'累積有效在線 10 小時');
  assert.match(ctx.titleConditionMeta(title).scope,/沒有每日時數上限/);
});
test('existing check-in and match progress retain their original units',()=>{
  assert.equal(ctx.titleGalleryProgressText({conditionType:'total_checkins',targetValue:30,progress:{currentValue:7}},false),'7／30');
  assert.equal(ctx.titleGalleryProgressText({conditionType:'official_matches',targetValue:100,progress:{currentValue:50}},false),'50／100');
});
