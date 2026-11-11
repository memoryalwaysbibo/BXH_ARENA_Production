(function(root){
  'use strict';
  const clean=value=>String(value??'').trim();
  function roomNameMode(meta={}){
    if(meta.ladderMode==='ranked')return 'realName';
    if(meta.participantNameMode==='gameId')return 'gameId';
    return meta.eventAuthority==='community'&&meta.participantNameMode==='any'?'any':'realName';
  }
  function participantIdentity(meta,profile={},child=null){
    const realName=clean(child?child.name:profile.realName)||(!child?clean(profile.displayName):'')||'玩家';
    const gameId=clean(child?child.nickname:profile.gameId)||(!child?clean(profile.nickname):'');
    const policy=roomNameMode(meta);
    const preference=child?.preferredNameMode??profile.preferredNameMode;
    const nameMode=policy==='any'?(preference==='gameId'?'gameId':'realName'):policy;
    return {realName,gameId,nameMode,displayName:nameMode==='gameId'?(gameId||realName):realName};
  }
  const api={roomNameMode,participantIdentity};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BXHParticipantNames=api;
})(typeof window==='object'?window:this);
