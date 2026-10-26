// RDW P3-37: isolated, opt-in, read-only admin diagnostic panel.
// Not loaded by the production index.html. No Firebase access or writes.
// A trusted callable client adapter must be explicitly provided by the host.
(function(root){
 'use strict';
 const EVENT=/^BXH-[A-Z0-9]{6}$/;
 function createDiagnosticPanel({container,fetchDiagnostic,canInspect=false}={}){
  if(!container||typeof container.appendChild!=='function'||typeof fetchDiagnostic!=='function')throw Error('rdw-panel-dependencies-required');
  const doc=container.ownerDocument;
  if(!doc||typeof doc.createElement!=='function')throw Error('rdw-panel-document-required');
  while(container.firstChild)container.removeChild(container.firstChild);
  const header=doc.createElement('h3');header.textContent='RDW 唯讀診斷';
  const hint=doc.createElement('p');hint.textContent='僅檢查階級來源、名單及倍率；不開賽、不封存快照、不修改積分。';
  const code=doc.createElement('input');code.type='text';code.placeholder='BXH-ABC123';code.maxLength=10;
  code.setAttribute('aria-label','賽事代碼');
  const run=doc.createElement('button');run.type='button';run.textContent='檢查 RDW';
  const status=doc.createElement('p');status.setAttribute('role','status');status.textContent=canInspect?'尚未執行':'僅限已授權管理員';
  const output=doc.createElement('pre');output.setAttribute('aria-label','RDW 診斷結果');output.textContent='';
  function show(result){
   if(!result||result.ok!==true||!Number.isSafeInteger(result.rosterSize)||!Number.isSafeInteger(result.verifiedAccounts)||!Number.isSafeInteger(result.virtualPlayers)||!Number.isSafeInteger(result.unverifiedAccounts)||!Array.isArray(result.formulaBands))throw Error('untrusted-diagnostic-response');
   const bands=result.formulaBands.map(b=>{
    if(![b.rawForwardPercent,b.rawReversePercent,b.protectedForwardPercent,b.protectedReversePercent].every(n=>Number.isSafeInteger(n)&&n>=90&&n<=110))throw Error('invalid-weight-data');
    return b.rawForwardPercent+'% / '+b.rawReversePercent+'%（保護模式 '+b.protectedForwardPercent+'% / '+b.protectedReversePercent+'%）';
   });
   // Use textContent exclusively: do not render HTML, UIDs, names, or raw backend response.
   output.textContent='參賽：'+result.rosterSize+' 人；可信帳號：'+result.verifiedAccounts+'；待核對：'+result.unverifiedAccounts+'；虛擬人物：'+result.virtualPlayers+
     '\n完整快照：'+(result.fullSnapshotEligible===true?'符合條件':'不可封存')+
     '\n倍率（方向依伺服器回傳順序）：'+(bands.join('；')||'無');
  }
  let inFlight=false;
  run.disabled=!canInspect;
  run.addEventListener('click',async()=>{
   if(!canInspect||inFlight)return;
   const eventCode=String(code.value||'').trim().toUpperCase();
   if(!EVENT.test(eventCode)){status.textContent='賽事代碼格式不正確';output.textContent='';return;}
   inFlight=true;run.disabled=true;status.textContent='唯讀檢查中';output.textContent='';
   try{
    const result=await fetchDiagnostic({eventCode});
    show(result);status.textContent='唯讀檢查完成';
   }catch(e){
    output.textContent='';status.textContent='無法取得可信診斷結果；請檢查登入、權限及後端服務狀態';
   }finally{inFlight=false;run.disabled=!canInspect;}
  });
  for(const node of [header,hint,code,run,status,output])container.appendChild(node);
  return Object.freeze({run,code,status,output});
 }
 const api=Object.freeze({createDiagnosticPanel});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BXHRDWDiagnosticPanel=api;
})(typeof window!=='undefined'?window:null);
