'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/player-cards.js'),'utf8'),team=fs.readFileSync(path.join(__dirname,'team-card.js'),'utf8');
function fixture(enabled){
 let uid='viewer',overlay=null,requests=[],navigation=[];const document={getElementById:id=>id==='player-card-overlay'?overlay:null,createElement:()=>({style:{},remove(){overlay=null;}}),body:{appendChild:e=>{overlay=e;}}};
 const window={BXH_TEAM_PREVIEW:enabled,BXHTeamUI:{css:''},BXHTeamOpenPublic:id=>(navigation.push(id),true),engagementService:{playerCard:async()=>({ok:true,card:{uid:'target',name:'玩家',playerId:'123'}}),tournamentOperation:async(name,payload)=>{requests.push({name,payload});return {team:{id:'team',name:'星隊',level:4,role:'member',selectedFrame:4}};}}};
 const ctx={window,document,playerCardsUI:{},currentAuthUid:()=>uid,esc:x=>String(x),render(){},titleChipHtml:()=>'',ladderDisplayTier:()=>'',showToast(){},managedFeatureError:()=> 'error'};
 vm.createContext(ctx);vm.runInContext(team,ctx);vm.runInContext(source,ctx);
 return {ctx,window,requests,navigation,get overlay(){return overlay;},setUid:value=>{uid=value;}};
}
test('public card loads a privacy-checked team and routes to the team',async()=>{
 const f=fixture(true);await f.window.BXHPlayerCardsFeature.handlePlayerCard('card-open',{getAttribute:()=> 'target'});f.window.BXHPlayerCardsFeature.renderPlayerCardOverlay();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].name,'teamRead');assert.equal(f.requests[0].payload.targetUid,'target');assert.match(f.overlay.innerHTML,/星隊/);assert.match(f.overlay.innerHTML,/team-frame-4/);
 const button={getAttribute:()=> 'team'};f.overlay.onclick({target:{closest:()=>button},preventDefault(){},stopPropagation(){}});assert.deepEqual(f.navigation,['team']);assert.equal(f.overlay,null);
});
test('disabled flag and unavailable team lookup do not falsely show no team',async()=>{
 const off=fixture(false);await off.window.BXHPlayerCardsFeature.handlePlayerCard('card-open',{getAttribute:()=> 'target'});off.window.BXHPlayerCardsFeature.renderPlayerCardOverlay();assert.equal(off.requests.length,0);assert.doesNotMatch(off.overlay.innerHTML,/尚未加入戰隊/);
 const denied=fixture(true);denied.window.engagementService.tournamentOperation=async()=>{throw Error('denied');};await denied.window.BXHPlayerCardsFeature.handlePlayerCard('card-open',{getAttribute:()=> 'target'});denied.window.BXHPlayerCardsFeature.renderPlayerCardOverlay();assert.doesNotMatch(denied.overlay.innerHTML,/尚未加入戰隊/);
});
test('account change during image download cannot attach the previous card image',async()=>{
 const f=fixture(true);let resolveImage;f.window.engagementService.tournamentOperation=async(_name,p)=>p.action==='card-team'?{team:{id:'team',name:'星隊',role:'member',level:4,hasEmblem:true}}:new Promise(resolve=>{resolveImage=resolve;});
 const pending=f.window.BXHPlayerCardsFeature.handlePlayerCard('card-open',{getAttribute:()=> 'target'});await new Promise(setImmediate);f.setUid('other');resolveImage({image:{contentType:'image/webp',base64:'UklGRgAAAABXRUJQ'}});await pending;
 const current=f.window.BXHPlayerCardsFeature.cardContext();assert.equal(current.uid,'other');assert.equal(current.card,null);assert.equal(current.teamInfo,undefined);
});
