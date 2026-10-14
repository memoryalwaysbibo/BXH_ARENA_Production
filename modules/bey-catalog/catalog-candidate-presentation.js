/* Read-only presentation for entries accepted by catalog-candidate-model. No mutation controls. */
'use strict';
(function(root) {
  const additionalNotices = Object.freeze({
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-drs.html": "©青木たかお・ベイブレードプロジェクト",
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-ld.html": "©Takafumi Adachi, MFBBProject, TV Tokyo",
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-rl.html": "©Takafumi Adachi, MFBBProject, TV Tokyo",
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-sp.html": "©Takafumi Adachi, MFBBProject, TV Tokyo",
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-ss.html": "ⒸHiro Morita, BBBProject, TV TOKYO",
  "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-xc.html": "ⒸHiro Morita, BBBProject, TV TOKYO"
});
  function createFigure(document, candidate) {
    const node = (tag,text,className) => { const e=document.createElement(tag);e.textContent=text || '';if(className)e.className=className;return e; };
    if (!candidate) return node('div','圖片待補','pending-image-placeholder');
    const figure=node('figure','','candidate-image');
    const image=document.createElement('img');
    image.loading='lazy';image.decoding='async';image.alt='候選圖片，尚未核實';image.src='./'+candidate.imageURL;
    const caption=node('figcaption',candidate.pairingConfidence==='exact_variant' ? '候選配圖 · 圖片與款式待核實' : '同商品參考圖，尚未確認本款配置');
    image.addEventListener('error',()=>{image.hidden=true;caption.textContent='候選圖片載入失敗 · 請保留待核狀態';},{once:true});
    const source=node('a','圖片來源');source.href=candidate.sourceURL;source.target='_blank';source.rel='noopener noreferrer';
    figure.append(image,caption,source);
    if(additionalNotices[candidate.sourceURL])figure.append(node('p',additionalNotices[candidate.sourceURL],'candidate-rights-note'));
    return figure;
  }
  function createManualImageHandoff(document, row, candidate, clipboard = root.navigator?.clipboard) {
    const node = (tag,text) => {const e=document.createElement(tag);e.textContent=text || '';return e;};
    const details=node('details','');details.className='manual-image-handoff';
    const summary=node('summary','手動補圖');summary.setAttribute('aria-label','手動補圖：'+row.code+'（'+row.suppliedId+'）');
    const explanation=node('p','此頁目前不會上傳或儲存圖片。請將圖片與下列資料傳給小黑，由小黑整理為待核候選圖。');
    const rights=node('p','請優先提供自己拍攝或已獲授權使用的圖片；若有原始來源連結，請一起提供。請註明完整型號、款式及配色，勿只填重複的商品代碼。');
    const label=node('label','補圖資料（可選取複製）');
    const input=node('textarea','');input.id='manual-image-template-'+row.suppliedId;label.htmlFor=input.id;
    input.readOnly=true;input.rows=8;input.spellcheck=false;
    input.value='清冊 ID：'+row.suppliedId+'\n型號：'+row.code+'\n提供名稱與配置：'+row.suppliedNameConfiguration+'\n目前候選圖片 SHA256：'+(candidate?.imageSha256 || '尚無候選圖片')+'\n用途：補圖／替換候選圖（請填）\n圖片對應款式與配色：（請填）\n圖片來源連結：（若有請填）\n圖片權利：自己拍攝／已獲授權（請填）';
    const button=node('button','複製補圖資料');button.type='button';
    const status=node('p','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    button.addEventListener('click',async()=>{
      if(button.disabled)return;button.disabled=true;
      try {
        if(!clipboard || typeof clipboard.writeText!=='function')throw Error('CLIPBOARD_UNAVAILABLE');
        await clipboard.writeText(input.value);status.textContent='已複製補圖資料。請將資料與圖片一起傳給小黑。';
      } catch(error) {
        try {input.focus();input.select();status.textContent='無法自動複製，已選取資料。請複製後，將資料與圖片一起傳給小黑。';}
        catch(selectionError) {status.textContent='無法自動複製。請長按或自行選取上方資料，再與圖片一起傳給小黑。';}
      } finally {button.disabled=false;}
    });
    details.append(summary,explanation,rights,label,input,button,status);return details;
  }
  const api=Object.freeze({createFigure,createManualImageHandoff});
  if(typeof module==='object' && module.exports)module.exports=api;else root.BXHCandidatePresentation=api;
})(typeof window==='object'?window:globalThis);
