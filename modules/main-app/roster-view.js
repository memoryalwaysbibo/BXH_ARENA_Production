(function(root){
 'use strict';
 const compounds=new Set('歐陽 司馬 上官 諸葛 皇甫 司徒 司空 夏侯 東方 公孫 令狐 慕容 宇文 尉遲 長孫 軒轅 獨孤 南宮 端木 西門 南門 聞人 太史 公羊 濮陽 宗政 仲孫 澹臺 公冶 拓跋 赫連 單于 淳于 申屠 公良 樂正 壤駟 宰父 谷梁'.split(' '));
 const collator=new Intl.Collator('zh-Hant-TW-u-co-stroke',{usage:'sort',sensitivity:'variant',numeric:true});
 const normalize=value=>String(value??'').normalize('NFKC').trim();
 const searchKey=value=>normalize(value).replace(/\s+/gu,'').toLocaleLowerCase('zh-Hant-TW');
 const surname=value=>{const chars=Array.from(normalize(value));const pair=chars.slice(0,2).join('');return compounds.has(pair)?pair:(chars[0]||'');};
 const isHan=value=>/^\p{Script=Han}/u.test(value);
 function compareNames(a,b){
  const left=normalize(a),right=normalize(b),sa=surname(left),sb=surname(right);
  return Number(!isHan(sa))-Number(!isHan(sb))||collator.compare(sa,sb)||collator.compare(left.slice(sa.length),right.slice(sb.length));
 }
 // Decorate copies; retain original row identities and indices for stable ties.
 function project(rows,{query='',sort='original',name=row=>row.name}={}){
  const wanted=searchKey(query);
  const entries=rows.map((row,index)=>({row,index,name:normalize(name(row))})).filter(e=>!wanted||searchKey(e.name).includes(wanted));
  if(sort==='stroke')entries.sort((a,b)=>compareNames(a.name,b.name)||a.index-b.index);
  return entries;
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let context='',query='',sort='original',epoch=0;
 const originals=new WeakMap();
 function apply(){
  const scope=root.document?.getElementById('people-roster-view');
  const tools=scope?.querySelector('#people-roster-tools');if(!tools)return;
  const table=scope.querySelector('table.people-roster-table'),body=table?.tBodies?.[0];
  let rows=[];
  if(body){
   if(!originals.has(body))originals.set(body,Array.from(body.rows));
   rows=originals.get(body);
   const visible=project(rows,{query,sort,name:r=>r.querySelector('.people-col-name')?.textContent||''});
   const allowed=new Set(visible.map(e=>e.row));
   // Reorder existing DOM nodes only. Every action keeps its original player ID.
   const ordered=sort==='stroke'?[...visible.map(e=>e.row),...rows.filter(r=>!allowed.has(r))]:rows;
   for(const row of ordered){row.hidden=!allowed.has(row);if(row.hidden)row.style.setProperty('display','none','important');else row.style.removeProperty('display');body.appendChild(row);}
   const counter=tools.querySelector('[data-roster-count]');if(counter)counter.textContent='顯示 '+visible.length+'／'+rows.length+' 人';
   const empty=tools.querySelector('[data-roster-empty]');if(empty)empty.hidden=!query||visible.length>0;
  }else{
   const counter=tools.querySelector('[data-roster-count]');if(counter)counter.textContent='顯示 0／0 人';
   const empty=tools.querySelector('[data-roster-empty]');if(empty)empty.hidden=true;
  }
 }
 function controls({contextKey,section,enabled=true}){
  if(context!==contextKey){context=contextKey;query='';sort='original';}
  const token=++epoch;
  if(!enabled||!['confirmed','pending','waitlist'].includes(section))return '';
  const active=root.document?.activeElement;
  const focus=active&&['people-roster-query','people-roster-sort'].includes(active.id)?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
  root.setTimeout(()=>{
   if(token!==epoch)return;apply();
   if(focus){const el=root.document?.getElementById(focus.id);if(el){el.focus({preventScroll:true});try{if(focus.start!=null)el.setSelectionRange(focus.start,focus.end);}catch{}}}
  },0);
  return '<section id="people-roster-tools" class="panel" aria-label="名單搜尋與排序" style="margin-top:12px"><div style="display:flex;flex-wrap:wrap;gap:12px"><div class="field" style="flex:1;min-width:160px"><label for="people-roster-query">姓名搜尋</label><input id="people-roster-query" type="search" maxlength="100" autocomplete="off" placeholder="輸入姓氏或部分姓名" value="'+esc(query)+'"></div><div class="field" style="flex:1;min-width:160px"><label for="people-roster-sort">名單排序</label><select id="people-roster-sort"><option value="original" '+(sort==='original'?'selected':'')+'>原始順序</option><option value="stroke" '+(sort==='stroke'?'selected':'')+'>姓氏筆畫（少 → 多）</option></select></div></div><div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-roster-clear>清除搜尋</button><span class="hint" data-roster-count role="status" aria-live="polite"></span></div><p class="hint" data-roster-empty hidden>找不到符合姓名的選手</p></section>';
 }
 if(root.document){
  root.document.addEventListener('input',e=>{if(e.target?.id==='people-roster-query'&&!e.isComposing){query=e.target.value;apply();}});
  root.document.addEventListener('compositionend',e=>{if(e.target?.id==='people-roster-query'){query=e.target.value;apply();}});
  root.document.addEventListener('change',e=>{if(e.target?.id==='people-roster-sort'){sort=e.target.value==='stroke'?'stroke':'original';apply();}});
  root.document.addEventListener('click',e=>{
   if(!e.target?.closest?.('[data-roster-clear]'))return;
   e.preventDefault();query='';const input=root.document.getElementById('people-roster-query');if(input){input.value='';input.focus({preventScroll:true});}apply();
  });
 }
 const api={project,compareNames,surname,controls,apply};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BXHRosterView=api;
})(typeof window==='object'?window:globalThis);
