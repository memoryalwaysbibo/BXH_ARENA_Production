"use strict";
(function installLadderHistorySort(){
  const STORAGE_KEY="bxh-ladder-history-sort";
  const TABLE_HEADERS=["時間","玩家","類型","異動","賽季"];
  const strokeCollator=(()=>{
    try{return new Intl.Collator("zh-Hant-u-co-stroke",{sensitivity:"base",numeric:true});}
    catch(e){return new Intl.Collator("zh-TW",{sensitivity:"base",numeric:true});}
  })();

  function parseNumber(text){
    const n=Number(String(text||"").replace(/[^\d.+-]/g,""));
    return Number.isFinite(n)?n:0;
  }

  function parseDate(text){
    const s=String(text||"").trim();
    const m=s.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m){
      let hour=Number(m[5]);
      if(m[4]==="下午"&&hour<12) hour+=12;
      if(m[4]==="上午"&&hour===12) hour=0;
      return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),hour,Number(m[6]),Number(m[7]||0)).getTime();
    }
    const t=Date.parse(s);
    return Number.isFinite(t)?t:0;
  }

  function isHistoryTable(table){
    const heads=[...table.querySelectorAll("thead th")].map(x=>x.textContent.trim());
    return TABLE_HEADERS.every((name,i)=>heads[i]===name);
  }

  function findTable(){
    return [...document.querySelectorAll("table")].find(isHistoryTable)||null;
  }

  function savedSort(){
    try{return sessionStorage.getItem(STORAGE_KEY)||"date-desc";}catch(e){return "date-desc";}
  }

  function saveSort(value){
    try{sessionStorage.setItem(STORAGE_KEY,value);}catch(e){}
  }

  function sortRows(table,mode){
    const body=table.tBodies?.[0];
    if(!body) return;
    const rows=[...body.rows].map((row,index)=>({row,index}));
    const cmp=(a,b)=>{
      const ac=a.row.cells,bc=b.row.cells;
      let n=0;
      if(mode==="points-asc") n=parseNumber(ac[3]?.textContent)-parseNumber(bc[3]?.textContent);
      else if(mode==="points-desc") n=parseNumber(bc[3]?.textContent)-parseNumber(ac[3]?.textContent);
      else if(mode==="name-asc") n=strokeCollator.compare(ac[1]?.textContent||"",bc[1]?.textContent||"");
      else if(mode==="name-desc") n=strokeCollator.compare(bc[1]?.textContent||"",ac[1]?.textContent||"");
      else if(mode==="date-asc") n=parseDate(ac[0]?.textContent)-parseDate(bc[0]?.textContent);
      else n=parseDate(bc[0]?.textContent)-parseDate(ac[0]?.textContent);
      return n||a.index-b.index;
    };
    rows.sort(cmp).forEach(x=>body.appendChild(x.row));
  }

  function install(){
    const table=findTable();
    if(!table) return;
    const scroll=table.closest(".rank-scroll")||table.parentElement;
    if(!scroll||scroll.previousElementSibling?.classList?.contains("ladder-history-sortbar")) return;

    const bar=document.createElement("div");
    bar.className="ladder-history-sortbar";
    bar.innerHTML=`<label><span>排序</span><select aria-label="最近積分紀錄排序">
      <option value="points-asc">積分異動｜小 → 大</option>
      <option value="points-desc">積分異動｜大 → 小</option>
      <option value="name-desc">姓名筆畫｜多 → 少</option>
      <option value="name-asc">姓名筆畫｜少 → 多</option>
      <option value="date-asc">日期｜早 → 晚</option>
      <option value="date-desc">日期｜晚 → 早</option>
    </select></label>`;
    scroll.parentElement?.insertBefore(bar,scroll);

    const select=bar.querySelector("select");
    select.value=savedSort();
    sortRows(table,select.value);
    select.addEventListener("change",()=>{
      saveSort(select.value);
      sortRows(table,select.value);
    });
  }

  const style=document.createElement("style");
  style.textContent=`
    .ladder-history-sortbar{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin:10px 0 12px;}
    .ladder-history-sortbar label{display:flex;align-items:center;gap:8px;color:var(--metal,#a9adb5);font-size:12px;font-weight:700;}
    .ladder-history-sortbar select{min-width:210px;max-width:100%;min-height:40px;padding:8px 34px 8px 12px;border:1px solid rgba(217,185,92,.34);border-radius:10px;background:#17181b;color:#f3f0e8;font:inherit;outline:none;}
    .ladder-history-sortbar select:focus{border-color:var(--gold,#d9b95c);box-shadow:0 0 0 2px rgba(217,185,92,.12);}
    @media(max-width:640px){.ladder-history-sortbar{justify-content:stretch}.ladder-history-sortbar label{width:100%;justify-content:space-between}.ladder-history-sortbar select{flex:1;min-width:0;}}
  `;
  document.head.appendChild(style);

  function tick(){if(!document.hidden)install();}
  setInterval(tick,1800);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick();});
  document.addEventListener("click",()=>setTimeout(tick,0),true);
  tick();
})();