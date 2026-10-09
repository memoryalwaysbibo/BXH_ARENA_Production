'use strict';
/** Structural validation only. Physical compatibility requires verified evidence. */
const TEMPLATES=Object.freeze({
 standard_3:['blade','ratchet','bit'],
 blade_ratchet_2:['blade_ratchet','bit'],
 cx_3_integrated_lower:['lock_chip','main_blade','assist_blade','ratchet_bit'],
 cx_3_standard:['lock_chip','main_blade','assist_blade','ratchet','bit'],
 cx_4_standard:['lock_chip','over_blade','metal_blade','assist_blade','ratchet','bit']
});
const ALIASES=Object.freeze({
 '一般三件式':'standard_3',
 '上盤／固鎖一體式':'blade_ratchet_2',
 'CX 三部件上盤＋固鎖／軸心一體式':'cx_3_integrated_lower',
 'CX 三部件上盤＋獨立固鎖＋軸心':'cx_3_standard',
 'CX 四部件上盤＋獨立固鎖＋軸心':'cx_4_standard'
});
function counts(parts){const c={};for(const p of parts)c[p.category]=(c[p.category]||0)+1;return c;}
function structuralCheck(parts,template){
 if(!Array.isArray(parts)||parts.some(p=>!p||!p.partId||!p.category))return {status:'invalid',reason:'PARTS_MALFORMED'};
 const type=ALIASES[template]||template,slots=TEMPLATES[type];
 if(!slots)return {status:'pending',reason:'STRUCTURE_UNKNOWN',template:type};
 const c=counts(parts),missing=slots.filter(x=>!c[x]);
 const extra=Object.entries(c).flatMap(([x,n])=>Array.from({length:n-(slots.includes(x)?1:0)},()=>x));
 if(missing.length||extra.length)return {status:'invalid',reason:'SLOT_MISMATCH',missing,extra,template:type};
 if(new Set(parts.map(x=>x.partId)).size!==parts.length)return {status:'invalid',reason:'DUPLICATE_PART_ID',template:type};
 return {status:'complete',reason:'STRUCTURE_COMPLETE',template:type};
}
function validateAssembly({parts,template,interfaceRules,ruleVersion}={}){
 const structure=structuralCheck(parts,template);
 if(structure.status!=='complete')return {...structure,canSaveAsVerified:false};
 if(!ruleVersion||!Array.isArray(interfaceRules))return {...structure,status:'pending',reason:'INTERFACE_EVIDENCE_MISSING',canSaveAsVerified:false};
 const known=new Set(parts.map(x=>x.partId));
 for(const r of interfaceRules){
  if(!r||!Array.isArray(r.partIds)||r.partIds.some(id=>!known.has(id)))continue;
  if(r.version!==ruleVersion||r.evidenceStatus!=='verified')continue;
  if(r.result==='incompatible')return {...structure,status:'invalid',reason:'VERIFIED_INCOMPATIBILITY',ruleId:r.ruleId,canSaveAsVerified:false};
 }
 const verified=interfaceRules.some(r=>r&&r.version===ruleVersion&&r.evidenceStatus==='verified'&&r.result==='compatible'&&Array.isArray(r.partIds)&&r.partIds.length===parts.length&&r.partIds.every(id=>known.has(id)));
 if(!verified)return {...structure,status:'pending',reason:'INTERFACE_EVIDENCE_MISSING',canSaveAsVerified:false};
 return {...structure,status:'verified',reason:'VERIFIED_ASSEMBLY',canSaveAsVerified:true,ruleVersion};
}
function assessResearchClaims(dataset){
 const parts=new Map(dataset.parts.map(x=>[x.partId,x]));
 return dataset.assemblyClaims.map(group=>{
  const ids=dataset.contentClaims.filter(x=>x.groupId===group.groupId).map(x=>x.partId);
  const actual=ids.map(id=>parts.get(id)).filter(Boolean);
  return {groupId:group.groupId,name:group.displayName,structure:group.structure,found:actual.length,expected:ids.length,...structuralCheck(actual,group.structure)};
 });
}
module.exports={TEMPLATES,ALIASES,structuralCheck,validateAssembly,assessResearchClaims};
