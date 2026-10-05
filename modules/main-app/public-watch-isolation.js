(function publicWatchIsolationPatch(){
  'use strict';

  const allowedTabs=new Set(['ladder','live','bracket']);
  const inPublicWatch=()=>publicWatchReturnContext||new URLSearchParams(location.search).get('entry')==='watch';
  const originalLineupPanel=renderTeamLineupPanel;
  const originalPrimeTeamMatchViews=primeTeamMatchViews;
  const originalRenderApp=renderApp;

  // Public/live pages must never render captain or referee controls.
  renderTeamLineupPanel=function(m,mode='player'){
    if(mode==='captain')return appPhase==='team-lineup'&&firebaseUser&&currentRole==='player'?originalLineupPanel(m,mode):'';
    if(inPublicWatch()&&mode!=='referee')return '';
    return originalLineupPanel(m,mode);
  };

  // Private lineup reads are reserved for the referee workstation.
  primeTeamMatchViews=function(){
    if(activeTab==='referee'&&!inPublicWatch())originalPrimeTeamMatchViews();
  };

  function sanitizePublicWatchUi(){
    if(!inPublicWatch())return;
    const app=document.getElementById('app');
    if(!app)return;

    app.querySelectorAll('[data-action="switch-tab"][data-tab]').forEach(button=>{
      if(!allowedTabs.has(button.dataset.tab))button.remove();
    });
    const v2=app.querySelector('#bxh-management-v2-nav');
    if(v2)v2.dataset.visibleTabs='ladder,live,bracket';

    app.querySelectorAll('.mode-management-context').forEach(node=>node.replaceChildren());
    app.querySelectorAll('.public-watch-return [data-action="cloud-admin-open-tournament"]').forEach(node=>node.remove());
    app.querySelectorAll('.public-watch-return span').forEach(node=>{node.textContent='目前為公開觀賽模式';});
    app.querySelectorAll('.account-role-label').forEach(node=>{node.textContent='觀賞模式';});
    app.querySelectorAll('.account-menu button').forEach(button=>{
      if(!['back-from-public-watch','account-logout'].includes(button.dataset.action))button.remove();
    });
  }

  renderApp=function(){
    if(inPublicWatch()&&!allowedTabs.has(activeTab))activeTab='live';
    originalRenderApp();
    sanitizePublicWatchUi();
  };
})();
