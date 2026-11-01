// Synthetic browser integration: executes production reminder rendering/actions.
// No Firebase calls, OAuth or real player records.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=read('modules/main-app/core.js');
const cut=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
const reminderFunctions=cut('function playerProfileReminderVisible(){','let googleLinkBusy=false;');
const editFunction=cut('function renderPlayerProfileEditModal(){','let playerProfileSection=');
const action=cut('  if(action==="player-profile-reminder-edit"||','  if(action==="player-close-profile-edit"){');
const fixture=`
const effectiveGameId=window.BXHAccountUtils.effectiveGameId;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let appPhase='player-center',playerActiveTab='home',currentRole='player',authVerifying=false,guestReadOnlyMode=false;
let playerProfileEditOpen=false,playerProfileEditBusy=false,playerProfileEditError='',playerProfileSection='overview';
let pendingModal=null,cloudJoinModalOpen=false,eventEntryModalOpen=false;
let firebaseUser={uid:'a'},userProfile={uid:'a',active:true,realName:'本名',gameId:'舊角色',phone:''};
let playerProfileReminder=window.BXHProfileReminder.create({storage:()=>sessionStorage,gameId:effectiveGameId});
const mailboxContext=()=>({open:false});
const profileLocationParts=()=>({city:'',region:''});
const profileCityOptionsHtml=()=>'',profileDistrictOptionsHtml=()=>'';
${reminderFunctions}
${editFunction}
function render(){document.body.innerHTML='<button id="home-action">首頁</button>'+renderPlayerProfileEditModal()+renderPlayerProfileReminder();}
function handle(action,target){${action}}
document.addEventListener('click',e=>{const t=e.target.closest('[data-action]');if(t)handle(t.dataset.action,t);});
function login(uid='a',time='one'){firebaseUser={uid};userProfile={uid,active:true,realName:'本名',gameId:'舊角色',phone:''};playerProfileReminder.syncAuth({uid,metadata:{lastSignInTime:time}});playerProfileReminder.acceptProfile(uid);render();}
window.fixture={login,render,set:(key,value)=>{if(key==='profile')userProfile=value;if(key==='tab')playerActiveTab=value;if(key==='phase')appPhase=value;render();},closeEditor:()=>{playerProfileEditOpen=false;playerActiveTab='home';render();},reload:()=>{playerProfileReminder=window.BXHProfileReminder.create({storage:()=>sessionStorage,gameId:effectiveGameId});login();}};
login();
`;
(async()=>{
  new (require('node:vm').Script)(fixture);
  const browser=await chromium.launch({headless:true});
  try{
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('http://profile-reminder.test/**',r=>r.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
      await page.goto('http://profile-reminder.test/');
      for(const file of ['account-utils.js','profile-reminder.js'])await page.addScriptTag({content:read('modules/main-app/'+file)});
      await page.addScriptTag({content:fixture});
      assert.equal(await page.getByRole('dialog').count(),1);
      assert.equal(await page.locator('#profile-reminder-description').textContent(),'請補齊尚未填寫的電話。');
      await page.getByRole('button',{name:'下一次',exact:true}).click();
      await page.evaluate(()=>fixture.render());assert.equal(await page.getByRole('dialog').count(),0);
      await page.evaluate(()=>fixture.reload());assert.equal(await page.getByRole('dialog').count(),0);
      await page.evaluate(()=>fixture.login('a','two'));assert.equal(await page.getByRole('dialog').count(),1);
      await page.getByRole('button',{name:'確定',exact:true}).click();
      assert.equal(await page.locator('#profile-phone').count(),1);
      assert.equal(await page.locator('#profile-gameid').inputValue(),'舊角色');
      assert.equal(await page.locator('#profile-realname').inputValue(),'本名');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'profile-phone');
      await page.evaluate(()=>fixture.closeEditor());assert.equal(await page.getByRole('dialog').count(),0);
      await page.evaluate(()=>fixture.login('b'));assert.equal(await page.getByRole('dialog').count(),1);
      await page.evaluate(()=>fixture.set('profile',{uid:'b',active:true,phone:'0912345678',gameId:'角色'}));
      assert.equal(await page.getByRole('dialog').count(),0);
      await page.evaluate(()=>{fixture.login('c');fixture.set('tab','registered');});assert.equal(await page.getByRole('dialog').count(),0);
      await page.evaluate(()=>{fixture.set('tab','home');fixture.set('phase','tournament-detail');});assert.equal(await page.getByRole('dialog').count(),0);
      assert.deepEqual(errors,[]);console.log('PASS profile reminder browser',viewport.width+'x'+viewport.height);
      await page.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
