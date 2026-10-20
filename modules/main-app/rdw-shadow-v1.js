// RDW v1: experimental rank differential weighting. Not wired to production scoring.
(function(root){
  'use strict';
  const TIERS=Object.freeze(['ungraded','e','d','c','b','a','s','national']);
  function weight(selfTier,opponentTier){
    const self=TIERS.indexOf(String(selfTier||'').toLowerCase());
    const opponent=TIERS.indexOf(String(opponentTier||'').toLowerCase());
    if(self<0||opponent<0)return null;
    return Number((1+(opponent-self)*0.01).toFixed(2));
  }
  function verifiedPreMatchWeight(snapshot){
    if(!snapshot||snapshot.source!=='server'||snapshot.verified!==true||
      !Number.isFinite(snapshot.capturedAt)||!Number.isFinite(snapshot.matchStartedAt)||
      snapshot.capturedAt>=snapshot.matchStartedAt||snapshot.capturedAt<=0)return null;
    return weight(snapshot.selfTierBefore,snapshot.opponentTierBefore);
  }
  const api=Object.freeze({version:'rdw-shadow-v1',tiers:TIERS,weight,verifiedPreMatchWeight});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.BXHRDWShadow=api;
})(typeof window!=='undefined'?window:null);
