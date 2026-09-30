/* BXH ARENA Management UI V2 — isolated navigation model.
 * No production wiring in this file yet.
 * Existing tab keys/handlers remain canonical.
 */
(function(global){
  "use strict";
  const GROUPS=[
    {id:"event",label:"賽事",tabs:["management","registrations","settings","people"]},
    {id:"field",label:"現場",tabs:["live","bracket","referee","duty"]},
    {id:"ranking",label:"排行",tabs:["ladder"]},
    {id:"activity",label:"活動",tabs:["member-raffles","inventory-admin"]},
    {id:"system",label:"系統",tabs:["operations","history","version"]}
  ];
  const LABELS={
    management:"賽事管理",registrations:"報名管理",settings:"賽事設定",people:"人員管理",
    live:"即時戰況",bracket:"對戰表",referee:"裁判台",duty:"我的執勤",
    ladder:"天梯排行","member-raffles":"會員抽獎管理","inventory-admin":"道具管理",
    operations:"抽獎與維護",history:"賽事紀錄",version:"版本更新"
  };
  function groupForTab(tab){return GROUPS.find(g=>g.tabs.includes(tab))||GROUPS[0];}
  function resolveActiveGroup(activeTab,visibleTabKeys){\n    const groups=visibleGroups(visibleTabKeys);\n    const direct=groups.find(g=>g.tabs.includes(activeTab));\n    return direct||groups[0]||null;\n  }\n  function firstVisibleTab(groupId,visibleTabKeys){\n    const allowed=new Set(visibleTabKeys||[]);\n    const group=GROUPS.find(g=>g.id===groupId);\n    return group ? (group.tabs.find(t=>allowed.has(t))||null) : null;\n  }\n  function visibleGroups(visibleTabKeys){
    const allowed=new Set(visibleTabKeys||[]);
    return GROUPS.map(g=>({...g,tabs:g.tabs.filter(t=>allowed.has(t))})).filter(g=>g.tabs.length);
  }
  function renderRails(activeTab,visibleTabs){
    const groups=visibleGroups(visibleTabs),selected=resolveActiveGroup(activeTab,visibleTabs);
    if(!selected)return "";
    return '<nav class="management-v2-groups" aria-label="管理功能群組">'+groups.map(g=>'<button type="button" data-management-v2-group="'+g.id+'" class="'+(g.id===selected.id?'active':'')+'">'+g.label+'</button>').join('')+'</nav>'
      +'<nav class="management-v2-children" aria-label="'+selected.label+'子選單">'+selected.tabs.map(t=>'<button type="button" data-management-v2-tab="'+t+'" class="'+(t===activeTab?'active':'')+'">'+(LABELS[t]||t)+'</button>').join('')+'</nav>';
  }
  function mount(options){
    options=options||{};const host=options.host;if(!host)return false;
    const visible=Array.isArray(options.visibleTabs)?options.visibleTabs:[];host.innerHTML=renderRails(options.activeTab,visible);
    host.onclick=function(e){
      const group=e.target.closest('[data-management-v2-group]'),tab=e.target.closest('[data-management-v2-tab]');
      if(group&&typeof options.onGroup==='function'){const t=firstVisibleTab(group.dataset.managementV2Group,visible);if(t)options.onGroup(t,group.dataset.managementV2Group);}
      else if(tab&&typeof options.onTab==='function')options.onTab(tab.dataset.managementV2Tab);
    };return true;
  }
  global.BXH_MANAGEMENT_UI_V2=Object.freeze({GROUPS,LABELS,groupForTab,resolveActiveGroup,firstVisibleTab,visibleGroups,renderRails,mount});
})(window);
