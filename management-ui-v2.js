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
  global.BXH_MANAGEMENT_UI_V2=Object.freeze({GROUPS,LABELS,groupForTab,resolveActiveGroup,firstVisibleTab,visibleGroups});
})(window);
