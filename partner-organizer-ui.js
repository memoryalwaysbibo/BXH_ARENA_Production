/* Partner organizer identity shell. A backend-issued grant is required before
   this mode is shown; this module does not grant privileges or create rooms. */
(function(root){
  function grant(profile){
    const value=profile&&profile.partnerOrganizer;
    return profile&&profile.active===true&&value&&typeof value==='object'&&value.status==='active'&&typeof value.organizationId==='string'&&value.organizationId.length>0?value:null;
  }
  function safe(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function render(profile){
    const value=grant(profile);
    if(!value)return '';
    const name=safe(value.organizationName||'合作主辦');
    return `<div class="partner-workspace"><div class="role-indicator">合作主辦｜${name} <button class="btn btn-ghost btn-sm" data-action="switch-to-player-mode">切換回玩家模式</button></div><section class="auth-card"><h2>合作主辦工作台</h2><p>此身分已開通。方案與賽事權限將由 BXH 後台設定並於此顯示。</p><p class="hint">正式開賽與積分資格需通過後端授權檢查。</p></section></div>`;
  }
  const api={hasGrant:profile=>!!grant(profile),render};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BXHPartnerOrganizer=api;
})(typeof window!=='undefined'?window:globalThis);
