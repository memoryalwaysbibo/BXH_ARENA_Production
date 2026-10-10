'use strict';

const VERSION='hunter-prematch-rating-snapshot-v1';
const ALLOWED_SOURCE='server';

function finite(n){ return typeof n==='number' && Number.isFinite(n); }
function nonempty(v){ return typeof v==='string' && v.trim().length>0; }

function normalizeProvider(provider){
  if(!provider || provider.source!==ALLOWED_SOURCE || provider.verified!==true) throw Error('rating-provider-untrusted');
  if(!nonempty(provider.version)) throw Error('rating-provider-version-required');
  if(!nonempty(provider.scale)) throw Error('rating-provider-scale-required');
  if(!finite(provider.selfBefore) || !finite(provider.opponentBefore)) throw Error('rating-provider-value-invalid');
  return {
    source:ALLOWED_SOURCE,
    verified:true,
    version:provider.version.trim(),
    scale:provider.scale.trim(),
    selfBefore:provider.selfBefore,
    opponentBefore:provider.opponentBefore
  };
}

function buildSnapshot({capturedAt,matchStartedAt,provider}){
  if(!finite(capturedAt) || !finite(matchStartedAt) || capturedAt<=0 || matchStartedAt<=0) throw Error('snapshot-time-invalid');
  if(capturedAt>=matchStartedAt) throw Error('snapshot-not-prematch');
  const p=normalizeProvider(provider);
  return Object.freeze({
    schemaVersion:VERSION,
    source:p.source,
    verified:true,
    ratingVersion:p.version,
    ratingScale:p.scale,
    capturedAt,
    matchStartedAt,
    selfBefore:p.selfBefore,
    opponentBefore:p.opponentBefore
  });
}

function equalSnapshot(a,b){
  return !!a && !!b &&
    a.schemaVersion===b.schemaVersion &&
    a.source===b.source &&
    a.verified===b.verified &&
    a.ratingVersion===b.ratingVersion &&
    a.ratingScale===b.ratingScale &&
    a.capturedAt===b.capturedAt &&
    a.matchStartedAt===b.matchStartedAt &&
    a.selfBefore===b.selfBefore &&
    a.opponentBefore===b.opponentBefore;
}

function seal(existing,input){
  const next=buildSnapshot(input);
  if(existing==null) return {snapshot:next,created:true};
  if(equalSnapshot(existing,next)) return {snapshot:existing,created:false};
  throw Error('snapshot-immutable');
}

function toHunterRatingSnapshot(snapshot){
  if(!snapshot || snapshot.schemaVersion!==VERSION || snapshot.source!==ALLOWED_SOURCE || snapshot.verified!==true) return null;
  if(!nonempty(snapshot.ratingVersion) || !nonempty(snapshot.ratingScale)) return null;
  if(!finite(snapshot.capturedAt) || !finite(snapshot.matchStartedAt) || snapshot.capturedAt<=0 || snapshot.matchStartedAt<=0 || snapshot.capturedAt>=snapshot.matchStartedAt) return null;
  if(!finite(snapshot.selfBefore) || !finite(snapshot.opponentBefore)) return null;
  return {
    source:'server',
    verified:true,
    version:snapshot.ratingVersion,
    scale:snapshot.ratingScale,
    capturedAt:snapshot.capturedAt,
    selfBefore:snapshot.selfBefore,
    opponentBefore:snapshot.opponentBefore
  };
}

module.exports={VERSION,buildSnapshot,seal,toHunterRatingSnapshot,equalSnapshot};
