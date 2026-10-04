/* BXH ARENA player login button label recovery.
   Keep the password form's primary action identifiable if its label is omitted
   during the auth-card render; leave Google sign-in and other auth screens alone. */
(function(){
  'use strict';
  function repairLoginButton(){
    document.querySelectorAll('.auth-card').forEach(function(card){
      var title=card.querySelector('.auth-card-title');
      if(!title || !/登入/.test(title.textContent||'')) return;
      var buttons=card.querySelectorAll('button.btn-block:not(.pw-eye-btn), input.btn-block[type="submit"]');
      for(var i=0;i<buttons.length;i++){
        var button=buttons[i];
        var text=button.tagName==='INPUT'?(button.value||''):(button.textContent||'').trim();
        var accessible=button.getAttribute('aria-label')||'';
        if(/google/i.test(text+' '+accessible)) continue;
        if(!text){
          if(button.tagName==='INPUT') button.value='登入';
          else button.textContent='登入';
          text='登入';
        }
        if(/登入/.test(text)){
          button.style.setProperty('color','#17130a','important');
          button.style.setProperty('font-weight','800','important');
          if(!accessible) button.setAttribute('aria-label','登入');
          break;
        }
      }
    });
  }
  repairLoginButton();
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',repairLoginButton,{once:true});
  }
  if(document.documentElement && window.MutationObserver){
    new MutationObserver(repairLoginButton).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  }
})();
