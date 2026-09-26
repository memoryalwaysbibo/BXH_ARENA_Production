/* BXH referee fault core
   Rule: two faults by the same player in the same round award the opponent +1 point.
   First fault is a pending round action, not a score event. */
'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.BXHRefereeFault=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SIDES=new Set(['A','B']);

  function side(v){return SIDES.has(v)?v:null;}
  function opposite(v){return v==='A'?'B':v==='B'?'A':null;}
  function cloneActions(value){
    const rows=Array.isArray(value)?value:[];
    return rows
      .map(x=>({side:side(x&&x.side),at:Number(x&&x.at)||0}))
      .filter(x=>x.side)
      .slice(-2);
  }
  function snapshot(match){return cloneActions(match&&match.faultActions);}
  function count(match,s){return snapshot(match).filter(x=>x.side===s).length;}
  function clear(match){if(match)match.faultActions=[];}
  function hasPending(match){return snapshot(match).length>0;}
  function lastPending(match){
    const rows=snapshot(match);
    return rows.length?rows[rows.length-1]:null;
  }
  function popPending(match){
    if(!match)return null;
    const rows=snapshot(match);
    const removed=rows.pop()||null;
    match.faultActions=rows;
    return removed;
  }
  function restoreFromEvent(match,event){
    if(!match)return;
    match.faultActions=cloneActions(event&&event.faultActionsBefore);
  }
  function attachSnapshotToEvent(match,event){
    if(!event)return event;
    event.faultActionsBefore=snapshot(match);
    return event;
  }
  function applyFault(match,offendingSide,at){
    const offender=side(offendingSide);
    if(!match||!offender)return {ok:false,reason:'invalid-side'};
    if(match.completed||match.status==='completed')return {ok:false,reason:'already-completed'};
    const actions=snapshot(match);
    const now=Number(at)||Date.now();
    const prior=actions.filter(x=>x.side===offender).length;
    if(prior<1){
      actions.push({side:offender,at:now});
      match.faultActions=actions;
      return {ok:true,scored:false,offendingSide:offender,count:1};
    }
    const recipient=opposite(offender);
    const scoreKey=recipient==='A'?'scoreA':'scoreB';
    const current=Number(match[scoreKey]||0);
    if(!Number.isFinite(current)||current+1>6)return {ok:false,reason:'invalid-score'};
    if(!Array.isArray(match.log))match.log=[];
    const before=actions;
    const seq=match.log.length+1;
    const event={
      v:1,
      eventId:String(match.id||'match')+':r'+seq+':'+now,
      seq,
      side:recipient,
      type:'fault',
      points:1,
      t:now,
      faultSide:offender,
      faultActionsBefore:before
    };
    match[scoreKey]=current+1;
    match.log.push(event);
    match.faultActions=[];
    return {ok:true,scored:true,offendingSide:offender,recipientSide:recipient,event};
  }
  return {snapshot,count,clear,hasPending,lastPending,popPending,restoreFromEvent,attachSnapshotToEvent,applyFault,opposite};
});
