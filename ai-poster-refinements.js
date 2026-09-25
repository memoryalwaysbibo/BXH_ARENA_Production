/* P7.13.1 — evidence-only hints, precise clocks and accessible review navigation.
   No network, persistence, room writes, or silent place-name correction. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BxhPosterRefinements=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const TARGETS=Object.freeze({
    'name-missing':'f-name','date-missing':'f-date','location-missing':'f-venue-name',
    'start-missing':'f-start','checkin-missing':'f-checkin',
    'registration-open-missing':'reg-open-at','registration-close-missing':'reg-close-at',
    'registration-order-invalid':'reg-close-at','capacity-missing':'reg-capacity',
    'format-unconfirmed':'f-format','review':'ai-create-review-panel'
  });
  const LABELS=[
    ['registration-close',/(?:報名截止(?:時間)?|截止報名(?:時間)?)/g],
    ['registration-open',/(?:報名(?:開放|開始|開跑)(?:時間)?|開放報名(?:時間)?|開始報名(?:時間)?|報名時間)/g],
    ['checkin',/(?:報到(?:開始)?時間|開始報到|報到開始)/g],
    ['start',/(?:開賽(?:時間)?|比賽開始(?:時間)?)/g]
  ];
  function preciseTime(value){
    if(!value)return true;
    const text=String(value);
    if(CLOCK.test(text))return true;
    const m=text.match(/^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::00)?(?:\+08:00|Z)$/);
    if(!m)return false;
    const d=new Date(m[1]+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===m[1];
  }
  function labeledTimes(text){
    // Keep separate label, time, channel and source evidence. Never borrow an event date.
    const source=String(text||'').slice(0,12000).normalize('NFKC');
    const out=[];
    for(const [kind,re] of LABELS){
      re.lastIndex=0;let label;
      while((label=re.exec(source))){
        const before=source.slice(Math.max(0,label.index-16),label.index);
        const tail=source.slice(re.lastIndex,re.lastIndex+100);
        // An announcement of an unknown opening time is not a confirmed opening.
        if(/(?:公布|公告|宣布|另行通知|待定)\s*$/.test(before))continue;
        const found=tail.match(/^\s*[:：]?\s*(?:((?:\d{4}[\/.-])?\d{1,2}[\/.-]\d{1,2})\s*(?:[（(][^）)\n]{1,5}[）)]\s*)?)?((?:[01]?\d|2[0-3]))\s*:\s*([0-5]\d)(?!\d)/);
        if(!found)continue;
        const time=found[2].padStart(2,'0')+':'+found[3];
        const rest=tail.slice(found[0].length).split(/[\n\r；;。]|(?:報名|報到|開賽|比賽開始)/,1)[0];
        if(/^\s*[:：\d]/.test(rest))continue; // malformed seconds or invalid clock fragments
        const channelMatch=rest.match(/(?:BXH\s*)?(?:粉專|粉絲專頁|Facebook|FB|LINE|Instagram|IG|Threads)/i);
        const onsite=/現場\s*$/.test(before)||/現場報名/.test(label[0]);
        out.push({kind,time,channel:channelMatch?channelMatch[0].trim():'',onsite,
          explicitDate:found[1]||null,evidence:source.slice(label.index,re.lastIndex+found[0].length+Math.min(rest.length,60)).trim()});
      }
    }
    return out;
  }
  function clockHint(result,kind){
    if(!result||result.sourceMode!=='poster-callable')return null;
    const field=kind==='registration-open'?'registrationOpenAt':'registrationCloseAt';
    if((result.warnings||[]).some(w=>w&&w.code==='source-conflict'&&String(w.field||'').includes(field)))return null;
    // Parse supplemental text separately, so two sources never get concatenated into a fabricated sentence.
    const rows=labeledTimes(result.posterText).concat(labeledTimes(result.posterSupplementText)).filter(x=>x.kind===kind&&!x.onsite);
    const dates=[...new Set(rows.map(x=>x.explicitDate).filter(Boolean))];
    if(dates.length>1)return null;
    const times=[...new Set(rows.map(x=>x.time))];
    if(times.length!==1)return null;
    const channels=[...new Set(rows.map(x=>x.channel).filter(Boolean))];
    return {time:times[0],channel:channels.join('／'),evidence:rows[0].evidence};
  }
  function venueCandidate(value){
    const text=String(value||'').trim();
    if(['南京','東京','西京'].includes(text.slice(0,2)))return null;
    for(const known of ['北京','北京麻辣鍋']){
      if(text===known)return null;
      // User-confirmed venue spelling is only a candidate, never authoritative evidence.
      if(text.length===known.length&&text.slice(2)===known.slice(2)&&
        [...text].filter((c,i)=>c!==known[i]).length===1)return known;
    }
    return null;
  }
  function targetId(code){return Object.prototype.hasOwnProperty.call(TARGETS,code)?TARGETS[code]:null;}
  function focusField(code,message,doc){
    doc=doc||(typeof document==='object'?document:null);
    const id=targetId(code);if(!id||!doc)return false;
    const hidden=doc.getElementById(id);if(!hidden)return false;
    const box=hidden.closest('.half-hour-time,.half-hour-datetime')||hidden;
    let parent=box.parentElement;
    while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    const input=box===hidden?hidden:(box.querySelector('.half-hour-date:not(:disabled)')||box.querySelector('select:not(:disabled)'));
    if(!input||input.disabled)return false;
    const field=box.closest('.field')||box;
    doc.querySelectorAll('.ai-review-target').forEach(node=>{if(node._bxhReviewCleanup)node._bxhReviewCleanup();});
    const note=doc.createElement('div');note.id='ai-review-field-note';note.className='ai-review-field-note';
    note.textContent=message||'請確認並修改此欄位。';note.setAttribute('role','status');field.appendChild(note);
    const oldInvalid=input.getAttribute('aria-invalid'),oldDescription=input.getAttribute('aria-describedby');
    field.classList.add('ai-review-target');input.setAttribute('aria-invalid',code==='review'?'false':'true');
    input.setAttribute('aria-describedby',[oldDescription,note.id].filter(Boolean).join(' '));
    const cleanup=()=>{
      field.classList.remove('ai-review-target');note.remove();
      if(oldInvalid===null)input.removeAttribute('aria-invalid');else input.setAttribute('aria-invalid',oldInvalid);
      if(oldDescription===null)input.removeAttribute('aria-describedby');else input.setAttribute('aria-describedby',oldDescription);
      field.removeEventListener('input',cleanup);field.removeEventListener('change',cleanup);delete field._bxhReviewCleanup;
    };
    field._bxhReviewCleanup=cleanup;field.addEventListener('input',cleanup);field.addEventListener('change',cleanup);
    if(input===box&&!input.matches('input,select,textarea,button,[tabindex]'))input.setAttribute('tabindex','-1');
    try{input.focus({preventScroll:true});}catch(_){input.focus();}
    const view=doc.defaultView;
    const reduced=!!(view&&view.matchMedia&&view.matchMedia('(prefers-reduced-motion: reduce)').matches);
    field.scrollIntoView({behavior:reduced?'auto':'smooth',block:'center',inline:'nearest'});
    return true;
  }
  return {preciseTime,labeledTimes,clockHint,venueCandidate,targetId,focusField};
});
