'use strict';
const fs=require('node:fs');
const {createOriginalAssemblyCandidates}=require('../modules/bey-catalog/stock-evidence-candidates.cjs');
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/bey-catalog-stock-audit.cjs /path/to/catalog-research.json');
const dataset=JSON.parse(fs.readFileSync(file,'utf8'));
const rows=createOriginalAssemblyCandidates(dataset);
const totals=Object.fromEntries(['ready_for_human_review','source_recheck_required','not_full_assembly'].map(s=>[s,rows.filter(x=>x.status===s).length]));
console.log(JSON.stringify({batchId:dataset.batchId,groups:rows.length,totals,autoApproved:0,autoPublished:0,rows},null,2));
