(function(){
'use strict';
// Account-bound entry. Preview fallback remains closed when the ARENA runtime is absent.
function createEntry({media=()=>navigator.mediaDevices,changed=()=>{},escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}={}){
  let host=null,mounted=null,mounting=false,mountEpoch=0;
  window.BXHArenaPK?.listen(changed);
  function unmount(){mountEpoch++;mounting=false;mounted?.dispose();mounted=null;host=null;}
  let uid='',user=null,profile=null,allowed=false,checked=false,epoch=0,stage='home',stream=null,cameraPending=false,cameraError='',active=false;
  function stop(){epoch++;cameraPending=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
  function reset(){unmount();window.BXHArenaPK?.setSession(null,null,false);stop();allowed=false;checked=false;stage='home';cameraError='';}
  function session(nextUser,nextProfile){
    const nextUid=nextUser?.uid||'';
    if(nextUid!==uid||nextUser!==user){reset();uid=nextUid;user=nextUser;}
    profile=nextProfile;
    if(!uid||profile?.active!==true||(profile.uid&&profile.uid!==uid)){allowed=false;checked=false;unmount();window.BXHArenaPK?.setSession(null,null,false);stop();return;}
    if(checked){window.BXHArenaPK?.setSession(user,profile,allowed);return;}
    checked=true;const owner=uid,sessionUser=user;
    Promise.resolve().then(async()=>{
      if(window.cloudAuth?.getHunterClashAccess)return window.cloudAuth.getHunterClashAccess(owner);
      return (await sessionUser.getIdTokenResult())?.claims?.hunterClashA1===true;
    }).then(access=>{
      if(uid!==owner||user!==sessionUser)return;
      allowed=access===true;window.BXHArenaPK?.setSession(user,profile,allowed);changed();
    }).catch(()=>{if(uid===owner&&user===sessionUser){allowed=false;changed();}});
  }
  function visible(){return !!uid&&profile?.active===true&&allowed;}
  function name(){return profile?.displayName||profile?.nickname||profile?.gameId||profile?.realName||user?.displayName||'未設定名稱';}
  function render(){
    if(!visible())return '';
    if(window.BXHArenaPK)return '<section data-hunter-clash-a1><div data-hc-runtime-host></div></section>';
    const notice='<p class="hint" role="status">入口整合測試；對戰服務尚未接入。此頁不產生戰績、XP 或成就。</p>';
    const back='<button type="button" class="btn btn-ghost" data-action="hunter-clash-back">返回</button>';
    const content=stage==='join'?`<h3>加入挑戰</h3><div class="hc-a1-camera"><video data-hc-camera autoplay playsinline muted aria-label="挑戰 QR 掃描預覽"></video><p data-hc-camera-status></p></div><button type="button" class="btn btn-ghost" data-action="hunter-clash-camera">重新開啟相機</button><label>或輸入 4 碼<input type="text" maxlength="4" pattern="[2-9A-HJ-NP-Z]{4}" autocomplete="off" autocapitalize="characters" placeholder="例如 A7K3" aria-label="四碼配對序號"></label><button class="btn btn-primary" disabled>確認加入（服務待接入）</button>${back}`:
      stage==='create'?`<h3>建立挑戰</h3><p class="hint">接入對戰服務後，這裡會顯示 QR 與四碼配對序號。</p><button class="btn btn-primary" disabled>建立挑戰（服務待接入）</button>${back}`:
      `<h3>下一場，換你上場。</h3><div class="hc-a1-actions"><button class="btn btn-primary" data-action="hunter-clash-create">建立挑戰</button><button class="btn btn-primary" data-action="hunter-clash-join">加入挑戰</button></div>`;
    return `<section class="panel hc-a1" data-hunter-clash-a1><div class="panel-title">獵人交鋒 <span class="badge">內測</span></div><p>玩家：${escape(name())}</p>${notice}${content}</section>`;
  }
  function attach(root){
    const video=root?.querySelector('[data-hc-camera]');
    if(video&&stream){video.srcObject=stream;video.play()?.catch(()=>{});}
    const status=root?.querySelector('[data-hc-camera-status]');
    if(status)status.textContent=cameraError||(stream?'相機預覽已開啟；QR 辨識將隨對戰服務接入。':'正在開啟相機…');
  }
  async function camera(root){
    if(!active||!visible()||stage!=='join'||stream||cameraPending||cameraError)return;
    const generation=epoch,owner=uid;cameraPending=true;cameraError='';
    try{
      const devices=media();if(!devices?.getUserMedia)throw Error('unsupported');
      const opened=await devices.getUserMedia({video:{facingMode:'environment'},audio:false});
      if(generation!==epoch||uid!==owner||!active||stage!=='join'||!visible()){opened.getTracks().forEach(t=>t.stop());return;}
      stream=opened;
    }catch(error){if(generation===epoch)cameraError=error.name==='NotAllowedError'?'相機未獲授權；服務接入後仍可輸入四碼加入。':'無法開啟相機，請檢查瀏覽器權限。';}
    finally{if(generation===epoch){cameraPending=false;attach(root);}}
  }
  function bind(root,isActive){
    if(window.BXHArenaPK){active=!!isActive&&visible();if(!active){unmount();return;}const slot=root?.querySelector('[data-hc-runtime-host]');if(!slot)return;if(host){slot.append(host);return;}host=document.createElement('div');slot.append(host);const owner=uid,stamp=++mountEpoch;mounting=true;window.BXHArenaPK.mount(host).then(value=>{if(stamp!==mountEpoch||owner!==uid||!active){value?.dispose();return;}mounted=value;mounting=false;}).catch(()=>{if(stamp===mountEpoch){host.textContent='對戰介面載入失敗，請切回後重試。';mounting=false;}});return;}
    active=!!isActive&&visible();if(!active){stop();return;}attach(root);if(stage==='join')void camera(root);}
  function handle(action){
    if(typeof action!=='string'||!action.startsWith('hunter-clash-'))return false;
    if(!visible())return true;
    if(action==='hunter-clash-join'){stage='join';cameraError='';}
    else if(action==='hunter-clash-create'){stop();stage='create';}
    else if(action==='hunter-clash-back'){stop();stage='home';}
    else if(action==='hunter-clash-camera'){stop();cameraError='';}
    changed();return true;
  }
  function suspend(){active=false;unmount();stop();}
  return {session,visible,render,bind,handle,suspend};
}
window.BXHHunterClashEntry={createEntry};
})();
