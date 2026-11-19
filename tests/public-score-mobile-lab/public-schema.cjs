'use strict';
// Lab schema is intentionally narrow; unsupported fields fail closed.
const text=v=>typeof v==='string'&&v.length<=160;
const number=v=>typeof v==='number'&&Number.isFinite(v);
const nullable=f=>v=>v===null||f(v);
const array=f=>v=>Array.isArray(v)&&v.length<=512&&v.every(f);
const object=(spec)=>v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>Object.hasOwn(spec,k)&&spec[k](v[k]));
const dict=f=>v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>/^[A-Za-z0-9_-]{1,80}$/.test(k)&&f(v[k]));
const bool=v=>typeof v==='boolean';
const pass=object({version:number,originStation:number,status:text,skippedAt:number,readyAt:nullable(number),assignedAt:nullable(number),assignedStation:nullable(number),requestedStation:nullable(number),manualRequestedAt:nullable(number),manualWaitFor:array(text),waitFor:array(text)});
const match=object({id:text,seq:nullable(number),bracket:nullable(text),round:number,indexInRound:number,station:nullable(number),a:nullable(object({playerId:text})),b:nullable(object({playerId:text})),isBye:bool,scoreA:nullable(number),scoreB:nullable(number),log:array(object({side:v=>['A','B'].includes(v),points:number,finish:text,at:number})),winnerId:nullable(text),loserId:nullable(text),completed:bool,resultMethod:nullable(text),completedAt:nullable(number),confirmedAt:nullable(number),status:text,skippedAt:nullable(number),callPass:nullable(object({waitFor:array(text)})),skipWaitFor:array(text),skipManualOnly:bool,resumeQueuedAt:nullable(number),passReturn:nullable(pass)});
const view=object({meta:object({stations:number}),players:array(object({id:text,name:text})),matches:array(match),courtAssignments:dict(object({currentMatchId:nullable(text),nextMatchId:nullable(text),status:text})),forcedCourtExits:dict(object({closed:bool,revision:number,at:nullable(number),reopenedAt:nullable(number),matchId:nullable(text)})),callRevision:number,courtLifecycleEpoch:number,championId:nullable(text),runnerUpId:nullable(text),thirdId:nullable(text),fourthId:nullable(text),gfMatchId:nullable(text),gfResetMatchId:nullable(text),bronzeMatchId:nullable(text),rrRounds:nullable(number),updatedAt:nullable(number)});
function validate(v){if(!view(v)||!Array.isArray(v.matches)||v.matches.length>511||v.matches.some(m=>!m.id)||new Set(v.matches.map(m=>m.id)).size!==v.matches.length)throw Error('unsupported-public-schema');return JSON.parse(JSON.stringify(v));}
module.exports={validate};
