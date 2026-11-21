#!/usr/bin/env python3
"""Read-only capture of the independently deployed activityCompletedTournamentBackfill source. No deploy/apply mode."""
from pathlib import Path,PurePosixPath
import datetime
import hashlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import zipfile

HELPER_SHA='a55aea8882b4fbd2d3aa57265f97b032bcebfb3784d11b7453bf63b5ae9777fb'
INVENTORY_SHA='c84cb0aff9509a93d1a94f96bedee9c81951d91a999423311ff7ce97af74af03'
TARGETS=[{'name': 'activityCompletedTournamentBackfill', 'state': 'ACTIVE', 'updateTime': '2026-09-27T18:37:00.508530064Z', 'runtime': 'nodejs22', 'entryPoint': 'activityCompletedTournamentBackfill', 'environment': 'GEN_2', 'codebase': None, 'sourceHashLabel': 'f45e4402b2cf035e329854635212e5f5f0c4a8ad', 'storageSource': {'bucket': 'gcf-v2-sources-87261141693-asia-east1', 'object': 'activityCompletedTournamentBackfill/function-source.zip', 'generation': '1790534209770356'}, 'trigger': {'eventType': None, 'eventFilters': []}, 'previouslyCapturedOrReviewedName': False, 'currentSourceClassification': 'not-performed-by-this-metadata-inventory'}]

def helper():
    for p in Path.home().glob('*bucketmaintenancefence*.py'):
        if p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==HELPER_SHA:
            spec=importlib.util.spec_from_file_location('verified_source_capture_helper',p)
            m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
    raise ValueError('Keep the verified updated bucketmaintenancefence.py in your home directory.')

def pointer(fn):
    b=fn.get('buildConfig',{})
    p=b.get('sourceProvenance',{}).get('resolvedStorageSource') or b.get('source',{}).get('storageSource',{})
    return {k:p[k] for k in ('bucket','object','generation') if k in p}

def same_metadata(fn,target,parent):
    return (fn.get('name')==parent+'/functions/'+target['name'] and fn.get('state')=='ACTIVE'
        and fn.get('updateTime')==target['updateTime'] and pointer(fn)==target['storageSource']
        and fn.get('buildConfig',{}).get('entryPoint')==target['entryPoint']
        and fn.get('buildConfig',{}).get('runtime')==target['runtime'])

def selected(files):
    out={};total=0
    for name,data in sorted(files.items()):
        p=PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or '\\' in name:raise ValueError('Unsafe archive path.')
        if any(part.startswith('.') or part in ('node_modules','test','tests','__tests__','fixtures') for part in p.parts):continue
        if re.search(r'(credential|secret|service.account|private.key)',name,re.I):continue
        if p.suffix not in ('.js','.cjs','.mjs','.ts') and p.name!='package.json':continue
        total+=len(data)
        if len(data)>4_000_000 or total>16_000_000 or len(out)>=600:raise ValueError('Filtered source budget exceeded.')
        out[name]=data
    if not out:raise ValueError('No reviewable code in source archive.')
    return out

def main():
    if len(sys.argv)>2 or len(sys.argv)==2 and sys.argv[1]!='prepare':raise ValueError('Usage: python3 -B bucketcaptureactivitybackfill.py prepare (read-only only).')
    m=helper()
    if m.run(['gcloud','config','get-value','project','--quiet'])!='bxh-arena':raise ValueError('Active project must be bxh-arena.')
    m.closed()
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination=Path.home()/('bucket-activity-backfill-source-'+stamp+'.zip')
    report={'stage':'ACTIVITY_BACKFILL_SOURCE_CAPTURE','inventorySha256':INVENTORY_SHA,'observedAt':stamp,'project':'bxh-arena','region':'asia-east1','productionWrites':0,'deploymentPerformed':False,'runtimeEnabled':False,'roomDataReads':0,'acceptanceCompleted':False,'coverage':'Exact independent activityCompletedTournamentBackfill source only; other services remain outside this capture.','functions':[],'sourceSets':[]}
    before={};hashes={};total=0
    # Build the output in temporary storage and publish only after readback checks.
    with tempfile.TemporaryDirectory(prefix='bxh-priority-writer-capture-') as d:
        temp=Path(d)
        import shutil
        if shutil.disk_usage(temp).free<128*1024*1024:raise ValueError('Less than 128 MiB free in temporary storage.')
        with zipfile.ZipFile(temp/'capture.zip','x',zipfile.ZIP_DEFLATED) as archive:
            for target in TARGETS:
                name=target['name']
                print('READONLY: capturing exact deployed source '+name,flush=True)
                fn=m.describe(name)
                if not same_metadata(fn,target,m.PARENT):raise ValueError('Source metadata changed since inventory: '+name+'; recapture/reconcile this function before proceeding.')
                before[name]=fn.get('updateTime')
                raw,files=m.capture(fn,temp,name)
                digest=hashlib.sha256(raw).hexdigest()
                number=hashes.get(digest)
                if number is None:
                    chosen=selected(files);total+=sum(map(len,chosen.values()))
                    if total>128_000_000:raise ValueError('Combined selected code budget exceeded.')
                    number=len(report['sourceSets']);hashes[digest]=number
                    report['sourceSets'].append({'id':number,'archiveSha256':digest,'files':[{'path':p,'sha256':hashlib.sha256(v).hexdigest(),'size':len(v)} for p,v in chosen.items()]})
                    for path,data in chosen.items():archive.writestr('sources/'+str(number)+'/'+path,data)
                report['functions'].append({'name':name,'entryPoint':target['entryPoint'],'runtime':target['runtime'],'updateTime':fn.get('updateTime'),'storageSource':pointer(fn),'codebase':fn.get('labels',{}).get('firebase-functions-codebase'),'eventTrigger':{'eventType':fn.get('eventTrigger',{}).get('eventType'),'eventFilters':fn.get('eventTrigger',{}).get('eventFilters',[])},'sourceSet':number,'classification':'pending-source-review'})
                if m.describe(name).get('updateTime')!=before[name]:raise ValueError('Concurrent source change: '+name)
                del raw,files
            for name,observed in before.items():
                if m.describe(name).get('updateTime')!=observed:raise ValueError('Concurrent source change before completion: '+name)
            m.closed()
            archive.writestr('report.json',json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        if (temp/'capture.zip').stat().st_size>64_000_000:raise ValueError('Output archive budget exceeded.')
        # O_EXCL prevents replacing a different capture from the same second.
        with destination.open('xb') as output,(temp/'capture.zip').open('rb') as source:
            shutil.copyfileobj(source,output)
    print(json.dumps({'stage':report['stage'],'capturedFunctions':len(report['functions']),'sourceSets':len(report['sourceSets']),'selectedCodeBytes':total,'productionWrites':0,'roomDataReads':0,'deploymentPerformed':False,'runtimeEnabled':False,'acceptanceCompleted':False,'reportFile':str(destination)},ensure_ascii=False,indent=2))

if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except Exception as e:
        reason=str(e) if isinstance(e,ValueError) or type(e).__name__=='Stop' else type(e).__name__
        print('STOP: '+reason+'\nNo deployment, configuration change or production data write attempted.',file=sys.stderr)
        sys.exit(1)
