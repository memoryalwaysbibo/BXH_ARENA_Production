'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const packId='gods_pack_BXH-ABC123';
function projected(overrides={}){
  // mailboxService list projection: no reward, no attachment kind/eventCode.
  return {id:packId,type:'card_reward',eventCode:'BXH-ABC123',subject:'諸神戰場卡包',
    senderName:'BXH ARENA 系統',createdAt:1,readAt:1,
    body:'第一段\\n\\n第二段',
    attachments:[{id:'gods_pack',name:'諸神戰場卡包 ×1',mime:'application/x-bxh-card-pack',size:1}],...overrides};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('projected self-test pack uses the same claimPack endpoint',async()=>{
 const t=setup(),id='gods_pack_TEST-20261006',message=projected({id,eventCode:'TEST-20261006'});
 assert.match(t.ui.card(message,false),/領取卡牌/);
 await t.ui.claim(id,message);
 assert.equal(t.calls.filter(x=>x.action==='claimPack'&&x.messageId===id).length,1);
});
test('self-test button sends through cardAlbum and never the archived direct-card endpoint',async()=>{
 const t=setup();t.s.window.engagementService.cardAlbum=async payload=>{t.calls.push(copy(payload));return {ok:true,messageId:'gods_pack_TEST-20261006'};};
 t.s.window.engagementService.issueSelfCardRewardE2ETest=async()=>{throw Error('archived route');};
 await t.s.window.BXHMailbox.handleMailbox('mailbox-self-card-test',null);
 assert.equal(t.calls.filter(x=>x.action==='issueSelfTestPack').length,1);
 assert(t.toasts.includes('諸神戰場測試卡包已送達站內信'));
});
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
  const calls=[],toasts=[];let quantity=0,claimed=false,claimImpl=null;
  const s={firebaseUser:{uid:'projection-player'},engagementSessionEpoch:1,
    currentAuthUid:()=>s.firebaseUser?.uid||'',accountMenuOpen:false,playerActiveTab:'cards',
    esc:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    render(){},renderPreservingScroll(){},showToast:x=>toasts.push(x),isSuperAdmin:()=>false,
    mailboxDate:()=> '2026/10/03',setTimeout(){},
    document:{addEventListener(){},getElementById:()=>null},window:{engagementService:{}}};
  s.window.engagementService.cardAlbum=async payload=>{
    calls.push(copy(payload));
    if(payload.action==='get')return {ok:true,sets:{basic:{},gods:{seal:quantity}},octoberCompleted:quantity};
    if(payload.action==='list')return {ok:true,incoming:[],outgoing:[]};
    assert.equal(payload.action,'claimPack');
    if(claimImpl)return claimImpl(payload);
    const replayed=claimed;if(!claimed){claimed=true;quantity++;}
    return {ok:true,replayed,cardId:'seal',bonus:[]};
  };
  s.window.engagementService.mailbox=async payload=>{calls.push(copy(payload));return {ok:true,messages:[projected()],unreadCount:0};};
  s.window.engagementService.getCardRewardMessage=async payload=>{calls.push({action:'details',...copy(payload)});throw Error('not-card-reward');};
  s.window.engagementService.claimCardReward=async ()=>{throw Error('wrong-claim-route');};
  vm.createContext(s);
  vm.runInContext(read('modules/main-app/mailbox.js'),s);
  vm.runInContext(read('modules/main-app/card-album.js'),s);
  const core=read('modules/main-app/core.js');
  const at=core.indexOf('const CARD_ALBUM_CARDS='),end=core.indexOf('function renderPlayerCenterLoggedIn()',at);
  assert(at>=0&&end>at);
  vm.runInContext(core.slice(at,end)+'\nconst capturedMailbox=window.BXHMailbox.handleMailbox;',s);
  vm.runInContext(read('card-reward-mail.js'),s);
  const mail=()=>s.window.BXHMailbox.mailboxContext();
  mail().messages=[projected()];mail().selectedId=packId;mail().open=true;
  s.target={getAttribute:name=>name==='data-message-id'?packId:null};
  return {s,calls,toasts,mail,ui:s.window.BXHCardRewardUI,
    view:()=>s.window.BXHMailbox.renderMailboxPage(),
    claim:()=>vm.runInContext("capturedMailbox('mailbox-card-reward',target)",s),
    select:()=>vm.runInContext("capturedMailbox('mailbox-select',target)",s),
    changeSession(){s.engagementSessionEpoch++;},onClaim:fn=>{claimImpl=fn;},quantity:()=>quantity};
}

test('projected pack without reward or attachment kind renders claim, not download, without a cloud write',()=>{
  const t=setup(),html=t.view();
  assert.match(html,/領取卡牌/);assert.doesNotMatch(html,/mailbox-download-attachment/);
  assert.equal(t.calls.length,0);assert.equal(t.quantity(),0);
  assert.match(html,/back\.webp/);
});
test('failed narrow reward-detail endpoint does not remove the projected pack claim button',async()=>{
  const t=setup();t.mail().selectedId='';await t.select();await tick();
  assert.match(t.view(),/領取卡牌/);assert.doesNotMatch(t.view(),/mailbox-download-attachment/);
  assert.equal(t.calls.filter(x=>x.action==='claimPack').length,0);
});
test('captured pre-bridge mailbox binding claims once, refreshes server inventory and retains server reveal after list reload',async()=>{
  const t=setup();await t.claim();await tick();
  assert.equal(t.calls.filter(x=>x.action==='claimPack').length,1);
  assert.equal(t.quantity(),1);assert.equal(t.mail().busy,false);assert.equal(t.mail().error,'');
  assert.match(t.view(),/已領取 ✓/);assert.match(t.view(),/seal\.webp/);
  assert.equal(t.s.window.BXHCardAlbumFeature.cardAlbumContext().data.sets.gods.seal,1);
  assert.equal(t.toasts.length,1);
});
test('two clicks during one pending projected pack claim issue only one server call',async()=>{
  const t=setup(),d=deferred();t.onClaim(()=>d.promise);
  const a=t.claim();await t.claim();
  assert.equal(t.calls.filter(x=>x.action==='claimPack').length,1);
  d.resolve({ok:true,replayed:false,cardId:'seal',bonus:[]});await a;await tick();
  assert.match(t.view(),/已領取 ✓/);
});
test('late successful claim after same-UID new session cannot create receipt, toast or reload in new session',async()=>{
  const t=setup(),d=deferred();t.onClaim(()=>d.promise);
  const pending=t.claim();t.changeSession();t.mail().messages=[projected()];t.mail().selectedId=packId;
  d.resolve({ok:true,cardId:'seal',bonus:[]});await pending;await tick();
  assert.equal(t.toasts.length,0);assert.equal(t.calls.length,1);
  assert.doesNotMatch(t.view(),/已領取 ✓/);assert.match(t.view(),/領取卡牌/);
});
test('failed claim keeps projected pack retryable and never invents a receipt or inventory',async()=>{
  const t=setup();t.onClaim(async()=>{throw Error('network');});await t.claim();
  assert.equal(t.mail().busy,false);assert.equal(t.quantity(),0);assert.notEqual(t.mail().error,'');
  assert.doesNotMatch(t.view(),/已領取 ✓/);t.onClaim(null);await t.claim();await tick();
  assert.equal(t.quantity(),1);assert.match(t.view(),/已領取 ✓/);
});
test('projected packs rely on backend idempotency after page/session reset rather than granting locally',async()=>{
  const t=setup();await t.claim();t.changeSession();t.mail().messages=[projected()];t.mail().selectedId=packId;
  await t.claim();await tick();assert.equal(t.quantity(),1);assert.match(t.view(),/已領取 ✓/);
});
test('projected signature is strict; title/name alone and conflicting IDs/types/mimes cannot create a card claim',()=>{
  const t=setup();
  const bad=[{id:'ordinary'},{eventCode:'BXH-ZZZZZZ'},{type:'notice'},
    {reward:{kind:'title'}},{attachments:[{id:'gods_pack',name:'諸神戰場卡包',mime:'application/pdf',size:1}]},
    {attachments:[{id:'wrong',mime:'application/x-bxh-card-pack',size:1}]},
    {attachments:[{id:'gods_pack',kind:'file',mime:'application/x-bxh-card-pack',size:1}]}];
  for(const fields of bad){const msg=projected(fields);assert.equal(t.ui.card(msg,false),'',JSON.stringify(fields));
    for(const item of msg.attachments)assert.equal(t.ui.isVirtualAttachment(msg,item),false);}
});
test('real PDF attachment beside a projected pack still downloads while the virtual pack does not',()=>{
  const t=setup();t.mail().messages[0].attachments.push({id:'pdf',name:'規章.pdf',mime:'application/pdf',size:1024});
  const html=t.view();assert.match(html,/領取卡牌/);
  assert.equal((html.match(/data-action="mailbox-download-attachment"/g)||[]).length,1);
  assert.match(html,/data-attachment-id="pdf"/);
});
test('literal escaped newlines normalize only for card packs; HTML remains escaped',()=>{
  const t=setup();t.mail().messages[0].body='甲\\n\\n<script>乙</script>';
  assert.match(t.view(),/甲\n\n&lt;script&gt;乙&lt;\/script&gt;/);
  t.mail().messages[0]=projected({type:'notice',body:'C:\\new\\notes'});
  assert.match(t.view(),/C:\\new\\notes/);
});
test('unrecognized server card ID is rejected without a claimed receipt',async()=>{
  const t=setup();t.onClaim(async()=>({ok:true,cardId:'unknown',bonus:[]}));await t.claim();
  assert.notEqual(t.mail().error,'');assert.doesNotMatch(t.view(),/已領取 ✓/);assert.equal(t.toasts.length,0);
});

test('attachment upload prompt accepts manual test mail and excludes projected card pack test mail',()=>{
 const source=read('registration-invitations-ui.js');
 const body=source.slice(source.indexOf('function stableAttachmentPanel(){'),source.indexOf("document.addEventListener('click',e=>{const button="));
 function prompt(message){
  let created=0;const ctx={messages:[message],selectedId:message.id,lastSent:null};
  const panel={dataset:{},style:{},querySelector:()=>({addEventListener(){}})};
  const document={getElementById:()=>null,createElement:()=>{created++;return panel;},body:{appendChild(){}}};
  vm.runInNewContext(body+';stableAttachmentPanel();',{document,runtime:()=>({profile:{role:'super_admin'},user:{uid:'admin'},mailbox:()=>ctx})});
  return created;
 }
 assert.equal(prompt(projected({id:'gods_pack_TEST-20261006',subject:'【測試】諸神戰場卡包已送達',eventCode:'TEST-20261006'})),0);
 assert.equal(prompt({id:'manual-test',type:'test',subject:'測試通知'}),1);
 assert.equal(prompt({id:'other',type:'announcement',subject:'【測試】活動通知'}),0);
});
