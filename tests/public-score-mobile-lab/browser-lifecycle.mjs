// Explicit spectator owner only. Document lifecycle never touches shared cloudUnsub.
export function bindSpectatorLifecycle({window,document,spectator,context,onError=()=>{}}){
 let pageHidden=false,disposed=false;const handlers=[];
 const sync=()=>{if(disposed)return Promise.resolve();return spectator.setContext({...context(),hidden:pageHidden||document.hidden}).catch(onError);};
 const on=(target,name,handler)=>{target.addEventListener(name,handler);handlers.push(()=>target.removeEventListener(name,handler));};
 on(document,'visibilitychange',sync);
 on(window,'pagehide',()=>{pageHidden=true;sync();});
 on(window,'pageshow',()=>{pageHidden=false;sync();});
 on(window,'online',sync);on(window,'popstate',sync);
 on(window,'spectator-route-change',sync);on(window,'spectator-identity-change',sync);
 return {sync,dispose(){disposed=true;handlers.forEach(stop=>stop());spectator.close();}};
}
