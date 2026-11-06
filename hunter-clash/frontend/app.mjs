const $=id=>document.getElementById(id);
const sandbox=location.origin==='http://127.0.0.1:5199';
const endpoint='http://127.0.0.1:5003/demo-hunter-clash/us-central1/hcSandboxCommand';
let token=null,snapshot=null,busy=false,pending=null;
const names={in_progress:'進行中',submitted:'結果已提交',pending_verification:'待見證認證',verified:'已認證',disputed:'有爭議',settled:'已結算'};
function message(text){$('message').textContent=text;}
function render(){
  const c=snapshot?.challenge,a=snapshot?.actor,r=snapshot?.result;
  $('signin').disabled=!sandbox||busy||!!token;$('logout').disabled=busy||!token;
  $('refresh').disabled=busy||!token;$('challenge').disabled=busy||!!pending;
  $('email').disabled=busy||!!token;$('password').disabled=busy||!!token;
  $('identity').textContent=a?`已登入：${a.uid}`:token?'已登入，請讀取挑戰。':'尚未登入';
  $('summary').textContent=c?`${c.challengeId} · ${names[c.status]||c.status} · 版本 ${c.revision}`:'尚未讀取挑戰。';
  $('score-summary').textContent=r?`${c.participants[0]} ${r.score.a}：${r.score.b} ${c.participants[1]} · ${r.riskStatus==='clear'?'風險已放行':'風險尚未放行'}`:'';
  for(const button of document.querySelectorAll('[data-operation]')){
    let allowed=false;
    if(c&&a){const participant=c.participants.includes(a.uid),admin=['admin','super_admin'].includes(a.role);
      switch(button.dataset.operation){
        case 'submit':allowed=participant&&c.status==='in_progress';break;
        case 'beginVerification':allowed=!participant&&a.uid===c.verificationActorUid&&c.status==='submitted';break;
        case 'verifyResult':allowed=!participant&&a.uid===c.verificationActorUid&&c.status==='pending_verification';break;
        case 'reviewRisk':allowed=!participant&&admin&&a.uid===c.riskReviewerUid&&c.status==='verified';break;
        case 'settle':allowed=!participant&&admin&&a.uid===c.settlementActorUid&&c.status==='verified'&&r?.riskStatus==='clear';break;
      }
    }
    button.disabled=busy||!!pending||!allowed;
  }
  $('retry').hidden=!pending;$('retry').disabled=busy||!token;
}
async function command(operation,input){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
    credentials:'omit',cache:'no-store',body:JSON.stringify({data:{operation,input}}),signal:AbortSignal.timeout(45000)});
  const body=await response.json();
  if(body.error){const error=Error(body.error.status);error.code=body.error.status;throw error;}
  if(!response.ok||!Object.hasOwn(body,'result'))throw Error('unknown-response');
  return body.result;
}
async function refresh(){snapshot=null;render();snapshot=await command('getChallenge',{challengeId:$('challenge').value.trim()});render();}
function failure(error){
  if(error.code==='UNAUTHENTICATED'){token=null;snapshot=null;pending=null;message('登入已失效，請重新登入並讀取狀態。');}
  else if(error.code==='PERMISSION_DENIED'){snapshot=null;message('此帳號沒有操作這場挑戰的權限。');}
  else if(error.code==='ABORTED'){snapshot=null;message('挑戰已有新版本，請讀取最新狀態後再操作。');}
  else if(error.code==='FAILED_PRECONDITION'){snapshot=null;message('目前狀態不允許此操作，請讀取最新狀態確認。');}
  else if(error.code)message('操作被拒絕，請檢查資料並讀取最新狀態。');
  else message('連線中斷，操作結果尚未確認。可讀取最新狀態，或重送同一筆操作。');
}
async function sendPending(){
  busy=true;let acknowledged=false;render();
  try{await command(pending.operation,pending.input);acknowledged=true;pending=null;await refresh();message('操作已完成，已讀取最新狀態。');}
  catch(error){if(error.code)pending=null;failure(error);if(acknowledged&&token)message('操作已確認，但讀取最新狀態失敗，請重新讀取。');}
  finally{busy=false;render();}
}
async function act(operation,decision){
  if(busy||pending||!snapshot)return;
  const c=snapshot.challenge,input={challengeId:c.challengeId,requestId:crypto.randomUUID(),expectedRevision:c.revision};
  if(operation==='submit'){
    const a=Number($('score-a').value),b=Number($('score-b').value);
    if(![a,b].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=100)||a===b){message('請輸入有效得分，兩方不得同分。');return;}
    input.score={a,b};input.winnerUid=c.participants[a>b?0:1];
  }else{input.resultRevision=c.resultRevision;if(decision)input.decision=decision;}
  if(operation==='reviewRisk'){input.reason=$('reason').value.trim();if(!input.reason){message('請填寫審查理由。');return;}}
  const text=operation==='submit'?`確認提交 ${input.score.a}：${input.score.b}，獲勝者 ${input.winnerUid}？`:operation==='settle'?'確認結算這場挑戰？結算後結果將鎖定。':'確認送出本次認證或審查？';
  if(!confirm(text))return;
  pending={operation,input};await sendPending();
}
$('login').addEventListener('submit',async event=>{
  event.preventDefault();if(!sandbox||busy)return;busy=true;render();
  try{
    const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{
      method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',
      body:JSON.stringify({email:$('email').value.trim(),password:$('password').value,returnSecureToken:true})});
    const body=await response.json();if(!response.ok||!body.idToken)throw Error('login-failed');
    token=body.idToken;snapshot=null;pending=null;message('登入成功，請輸入被指派的挑戰編號。');
  }catch{message('登入失敗，請確認測試帳號與連線。');}
  finally{$('password').value='';busy=false;render();}
});
$('logout').addEventListener('click',()=>{token=null;snapshot=null;pending=null;$('email').value='';message('已登出。');render();});
$('load').addEventListener('submit',async event=>{event.preventDefault();if(busy||!token)return;busy=true;render();try{await refresh();message('已讀取最新狀態。');}catch(error){failure(error);}finally{busy=false;render();}});
$('submit').addEventListener('submit',event=>{event.preventDefault();act('submit');});
for(const button of document.querySelectorAll('[data-operation]:not([data-operation="submit"])'))
  button.addEventListener('click',()=>act(button.dataset.operation,button.dataset.decision));
$('retry').addEventListener('click',()=>{if(pending&&!busy)sendPending();});
render();if(!sandbox)message('此測試介面只能在指定的本機測試環境使用。');
