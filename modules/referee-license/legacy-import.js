/* Owner-approved, hash-pinned legacy import. Uses existing callable authorization and receipts. */
(function (root) {
  'use strict';
  const EXPECTED_SHA = '24f9e9c9b0b3c56643a0d1ca4f778088449ed12eb863da33a41fc03a7be43a72';
  const COUNTS = [244,25,108,152,171,298,90,91,0,33,22,276,108,159,49,32,31,77];

  const KEY = 'bxh-referee-legacy-apply-' + EXPECTED_SHA;
  function need(ok, reason) { if (!ok) throw new Error(reason); }
  async function hash(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2,'0')).join('');
  }
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  async function validatePlan(bytes) {
    need(bytes.byteLength <= 8*1024*1024, 'plan-too-large');
    need(await hash(bytes) === EXPECTED_SHA, 'plan-sha-mismatch');
    const plan = JSON.parse(new TextDecoder().decode(bytes));
    need(plan.mode === 'READ_ONLY_PREVIEW_NOT_APPLIED' && plan.people?.length === 18, 'plan-shape');
    need(new Set(plan.people.map(p=>p.uid)).size===18, 'roster-duplicate');
    let batches = 0;
    for (const [i,p] of plan.people.entries()) {
      need(p.order===i+1 && typeof p.uid==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.uid) && p.personId==='initial-'+String(i+1).padStart(2,'0') && p.count===COUNTS[i], 'roster-mismatch');
      const keys = Object.keys(p.sourceMap).sort(), used = [];
      need(keys.length === p.count, 'source-count');
      for (const key of keys) {
        const rows = p.sourceMap[key]; need(Array.isArray(rows) && rows.length>0, 'source-empty');
        for (const row of rows) {
          need(row.document.startsWith('projects/bxh-arena/databases/(default)/documents/staffActivityLogs/'+p.uid+'/matches/'), 'source-path');
          need(key==='historical:legacy_'+await hash(JSON.stringify([p.uid,row.tournamentCode,row.matchId])), 'source-key-mismatch');
        }
      }
      for (const [j,b] of p.batches.entries()) {
        const e=b.entry;
        need(b.batch===j+1 && e.kind==='decision' && e.events===0 && e.auxiliary===0 && e.size===null && e.precision==='unknown' && e.sourceUid===null && !e.id, 'entry-scope');
        need(e.decisions>0 && e.decisions<=200 && e.sourceKeys.length===e.decisions && e.sourceKey===e.sourceKeys[0], 'entry-count');
        used.push(...e.sourceKeys); batches++;
      }
      need(equal(used.slice().sort(),keys), 'batch-source-mismatch');
    }
    need(batches===20, 'batch-count');
    return plan;
  }
  const certIdentity = c => {
    need(c, 'certificate-missing');
    return [c.number,c.personId,c.awardedLevel,c.status,c.issuedAt,c.approvedBy,c.approvedAt,c.photoDataUrl,c.isChief];
  };
  function checkSnapshot(s,p,baseline,applied,batches) {
    need(s?.uid===p.uid && Number.isSafeInteger(s.revision), 'snapshot-identity');
    need(s.certificate?.number==='R'+String(p.order).padStart(6,'0') && s.certificate.personId===p.personId && s.certificate.awardedLevel===1 && s.certificate.status==='active', 'certificate-mismatch');
    need(s.incomplete===false && !s.historyTruncated, 'snapshot-incomplete');
    need(s.backfills?.length===batches.length && s.backfills.every(e=>e.status==='active' && e.recognitionValid===true), 'backfill-state');
    for (let j=0;j<batches.length;j++) {
      const matches=s.backfills.filter(e=>equal(e.sourceKeys,batches[j].entry.sourceKeys));
      need(matches.length===1 && matches[0].decisions===batches[j].entry.decisions && matches[0].kind==='decision' && matches[0].events===0, 'backfill-readback');
    }
    need(s.stats?.decisions===applied && s.stats.backfillDecisions===applied && s.stats.eventCount===0 && Object.values(s.stats.scales).every(v=>v===0), 'totals-readback');
    if (baseline) need(equal(certIdentity(s.certificate),certIdentity(baseline.certificate)) && s.photoDataUrl===baseline.photoDataUrl && s.chiefRevision===baseline.chiefRevision, 'certificate-photo-changed');
  }
  async function execute(plan,call,storage,progress) {
    need(!storage.getItem(KEY), 'prior-run-exists-do-not-repeat');
    const journal={planSha:EXPECTED_SHA,status:'preflight',confirmedBatches:0,rows:[],writesAttempted:0};
    const save=()=>{const raw=JSON.stringify(journal); storage.setItem(KEY,raw);need(storage.getItem(KEY)===raw,'journal-write-failed');};
    const request=async payload=>{const r=await call(payload);need(r?.ok && r.snapshot,'callable-failed');return r.snapshot;};
    const who=async()=>need((await request({action:'get'})).uid===plan.people[0].uid,'owner-login-required');
    try {
      await who();
      const baseline=new Map();
      for(const p of plan.people) {
        const s=await request({action:'get',targetUid:p.uid});
        checkSnapshot(s,p,null,0,[]);baseline.set(p.uid,s);
        progress('預檢 '+p.order+'/18：'+p.name);
      }
      save();
      for(const p of plan.people) {
        const completed=[];let applied=0;
        for(const b of p.batches) {
          await who();
          const current=await request({action:'get',targetUid:p.uid});
          checkSnapshot(current,p,baseline.get(p.uid),applied,completed);
          const operationId='legacy_'+EXPECTED_SHA.slice(0,24)+'_'+p.order+'_'+b.batch;
          journal.status='outcome-unknown';journal.pending={order:p.order,batch:b.batch,operationId,expectedRevision:current.revision};
          journal.writesAttempted++;save();
          progress('送出 '+p.name+' 第 '+b.batch+' 批；請勿切換帳號或關閉頁面');
          const result=await request({action:'saveBackfill',targetUid:p.uid,operationId,expectedRevision:current.revision,entry:b.entry});
          completed.push(b);applied+=b.entry.decisions;
          checkSnapshot(result,p,baseline.get(p.uid),applied,completed);
          const verified=await request({action:'get',targetUid:p.uid});
          checkSnapshot(verified,p,baseline.get(p.uid),applied,completed);
          need(verified.revision===current.revision+1, 'unexpected-revision');
          journal.confirmedBatches++;journal.status='confirmed';delete journal.pending;save();
        }
        journal.rows.push({order:p.order,name:p.name,decisions:applied});save();
      }
      // Re-read every person after the entire batch; no success based on local counters alone.
      for(const p of plan.people) checkSnapshot(await request({action:'get',targetUid:p.uid}),p,baseline.get(p.uid),p.count,p.batches);
      journal.status='verified';journal.total=journal.rows.reduce((n,r)=>n+r.decisions,0);save();
      progress('完成：20批、1966場已回讀確認。階級、照片、參與賽事與規模保持原狀。');
    } catch(error) {
      journal.stopReason=String(error?.code||error?.message||'unknown').slice(0,180);
      journal.status=journal.pending?'outcome-unknown':'stopped';
      try{save();}catch{}
      progress('已停止。不要重跑或清除瀏覽器紀錄；下載結果交回核對。');
    }
    return journal;
  }
  const api=Object.freeze({validatePlan,execute,KEY,EXPECTED_SHA});
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.BXHRefereeLegacyImport=api;
})(globalThis);
