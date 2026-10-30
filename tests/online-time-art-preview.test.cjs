'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),ctx={window:{}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/title-utils.js'),'utf8'),ctx);
const api=ctx.window.BXHTitleUtils;
test('preview is explicitly authorized and cannot impersonate an earned title',()=>{
  for(const value of [false,undefined,null,'true',1])assert.equal(api.onlineTimeArtworkPreviewHtml(value),'');
  const html=api.onlineTimeArtworkPreviewHtml(true);
  assert.match(html,/微光初現/);assert.match(html,/最高管理員外觀驗收/);
  assert.match(html,/尚未開放取得/);assert.match(html,/不代表已取得稱號/);
  assert.doesNotMatch(html,/button|input|select|fetch\(|httpsCallable|localStorage/);
  assert.match(html,/width:100%;height:auto/);
});
test('all six approved artworks retain mapping, tier, size, lossless alpha and PNG fallback',()=>{
  const titles=[['微光初現',1,'common'],['星光漸明',10,'common'],['流光刻痕',50,'rare'],['百時星軌',100,'rare'],['歲月銘刻',500,'epic'],['千載流光',1000,'legendary']];
  const html=api.onlineTimeArtworkPreviewHtml(true);
  const ladder=fs.readFileSync(path.join(root,'ladder-secondary-ui.js'),'utf8');
  for(const [name,hours,tier] of titles){
    const p=api.titleArtworkPath(name,tier);assert.equal(p,`assets/title-${tier}-online-time-${hours}h-v1.webp`);
    const webp=fs.readFileSync(path.join(root,p)),png=fs.readFileSync(path.join(root,p.replace('.webp','.png')));
    assert.equal(webp.toString('ascii',0,4),'RIFF');assert.equal(webp.toString('ascii',12,16),'VP8L');
    assert.equal(webp.readUInt32LE(4)+8,webp.length);assert.equal((webp.readUInt32LE(21)>>>28)&1,1);
    assert.equal(png.readUInt32BE(16),768);assert.equal(png.readUInt32BE(20),270);assert.equal(png[25],6);
    assert(ladder.includes('"'+name+'":"'+p+'"'));assert(html.includes(`src="${p}"`));
    assert(html.includes(`data-online-title="online_time_${hours}h"`));
  }
  assert.equal((html.match(/<details /g)||[]).length,5);assert.doesNotMatch(html,/<details[^>]*\bopen/);
  assert.equal((html.match(/loading="lazy"/g)||[]).length,6);
  assert.match(html,/dataset.fallback='png'/);
});
test('real title-center renderer exposes the preview only through its super-admin gate',()=>{
  const source=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
  const start=source.indexOf('function renderPlayerTitleCenter(p){'),end=source.indexOf('let communityEventsCache',start);
  const setup={window:ctx.window,engagementTitleDraft:null,engagementSnapshot:{catalog:[],earned:[]},engagementLoading:false,engagementError:'',
    engagementSettings:()=>({titlesEnabled:true}),earnedTitleIds:()=>new Set(),titleById:()=>null,
    formatTitleDisplay:()=>'',effectiveGameId:()=>'',esc:String,engagementActionBusy:false,isSuperAdmin:()=>false};
  const renderCtx=vm.createContext(setup);vm.runInContext(source.slice(start,end),renderCtx);
  assert.doesNotMatch(renderCtx.renderPlayerTitleCenter({}),/data-online-time-art-preview/);
  renderCtx.isSuperAdmin=()=>true;
  assert.match(renderCtx.renderPlayerTitleCenter({}),/data-online-time-art-preview/);
  assert.equal(renderCtx.engagementSnapshot.earned.length,0);assert.equal(renderCtx.engagementSnapshot.catalog.length,0);
});
