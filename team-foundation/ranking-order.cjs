'use strict';
// Pure ranking rule used by both the current bounded reader and a future snapshot builder.
// Competition ranks: scores 100,100,90 produce ranks 1,1,3.
function rankSnapshot(rows){
 if(!Array.isArray(rows))throw Error('invalid-ranking-rows');
 const seen=new Set();
 for(const row of rows){if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(row.id)||seen.has(row.id)||!Number.isFinite(row.strength)||row.strength<0)throw Error('invalid-ranking-row');seen.add(row.id);}
 const sorted=[...rows].sort((a,b)=>b.strength-a.strength||a.id.localeCompare(b.id));
 let rank=0;return sorted.map((row,i)=>{if(i===0||row.strength!==sorted[i-1].strength)rank=i+1;return {...row,rank};});
}
module.exports={rankSnapshot};
