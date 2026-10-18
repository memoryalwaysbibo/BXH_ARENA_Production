"use strict";
(function(root){
  // Locations belong to a specific score snapshot. Old requests cannot replace
  // a refreshed board, and no private member document is read by the browser.
  function createLoader(fetchLocations,onChange){
    const states=new WeakMap();
    function state(snapshot){
      if(!states.has(snapshot)) states.set(snapshot,{status:"idle",locations:new Map()});
      return states.get(snapshot);
    }
    function ensure(snapshot){
      const current=state(snapshot);
      if(current.status!=="idle") return current;
      current.status="loading";
      current.promise=(async()=>{
        await Promise.resolve();
        try{
          const ids=[...new Set((snapshot.players||[]).map(p=>p.uid).filter(Boolean))];
          const locations=new Map();
          // Bounded batches; publish only after every batch succeeds.
          let next=0;
          async function worker(){
            while(next<ids.length){
              const start=next; next+=100;
              const chunk=ids.slice(start,start+100),response=await fetchLocations(chunk);
              if(response?.ok!==true||response.version!==1||!response.locations) throw Error("invalid-location-response");
              for(const uid of chunk){
                const loc=response.locations[uid];
                if(!loc||typeof loc.city!=="string"||typeof loc.region!=="string") throw Error("incomplete-location-response");
                locations.set(uid,{city:loc.city,region:loc.region});
              }
            }
          }
          await Promise.all([worker(),worker()]);
          current.locations=locations;
          current.status="ready";
        }catch(_){
          current.locations=new Map();
          current.status="error";
        }
        onChange(snapshot);
      })();
      return current;
    }
    return {state,ensure};
  }
  if(typeof module==="object"&&module.exports) module.exports={createLoader};
  else root.BXHLadderLocations=createLoader(
    ids=>{
      if(!root.cloudSync?.getLadderLocations) throw Error("location-service-unavailable");
      return root.cloudSync.getLadderLocations(ids);
    },
    snapshot=>{if(typeof ladderPublicData!=="undefined"&&ladderPublicData===snapshot&&typeof render==="function") render();}
  );
})(typeof window!=="undefined"?window:globalThis);
