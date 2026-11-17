#!/usr/bin/env python3
"""Prepare or apply PR 815 as four exact function replacements on captured live source."""
import argparse, base64, hashlib, json, os, shlex, stat, subprocess, tempfile, zipfile, zlib
from pathlib import Path

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'commitRefereeCommand'
GENERATION = '1794824386408821'
SOURCE_URI = 'gs://gcf-v2-sources-87261141693-asia-east1/commitRefereeCommand/function-source.zip#' + GENERATION
LIVE_SHA = '0d7703606695bfd77cfb43ada72df7452d611367d833eba68e4be88225948116'
EXPECTED_SHA = '3e40412b390fac6115c9e93771fd1a15961b3a053956bf013497740fa811eb0b'
DEPENDENCIES = {
 'engine/court-retirement.cjs': '597add4bf231a629e62385d61f970610ab59638055b45f3dfc834f04a5b447b0',
 'engine/match-utils.cjs': '60fdd13744d49acc2c28b42d12ff8c975841b8f6e891bd80cbd6832ef0c3fb53',
 'engine/double-elimination.cjs': 'db9a6b0d815a10c2853c2d48794f297385b23798ce441e904c24246ddf32ab1c',
 'engine/fault.cjs': '26da0500abd88622bf9f49555287dd5ed7a7e311f232dc5adae027fce6e25266',
}
PATCH_DATA = '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'
TEST_DATA = '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'

def digest(data):
 return hashlib.sha256(data).hexdigest()

def command(args):
 p = subprocess.run(args, check=False, capture_output=True, text=True)
 if p.returncode:
  raise RuntimeError('Command failed: ' + shlex.join(args[:4]))
 return p.stdout

def describe():
 return json.loads(command(['gcloud','functions','describe',FUNCTION,'--gen2','--project='+PROJECT,'--region='+REGION,'--format=json','--quiet']))

def source(info):
 return info.get('buildConfig',{}).get('source',{}).get('storageSource',{})

def configuration(info):
 service=info.get('serviceConfig',{})
 keys=('service','timeoutSeconds','availableMemory','availableCpu','maxInstanceCount','minInstanceCount','serviceAccountEmail','ingressSettings','environmentVariables','secretEnvironmentVariables','secretVolumes','vpcConnector','vpcConnectorEgressSettings')
 return {'runtime':info['buildConfig']['runtime'],'entryPoint':info['buildConfig']['entryPoint'],**{k:service.get(k) for k in keys}}

def require_baseline(info):
 if info.get('name')!='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+FUNCTION or info.get('state')!='ACTIVE':
  raise RuntimeError('Unexpected function or non-ACTIVE state')
 s=source(info)
 if str(s.get('generation'))!=GENERATION or s.get('bucket')!='gcf-v2-sources-87261141693-asia-east1' or s.get('object')!=FUNCTION+'/function-source.zip':
  raise RuntimeError('Live source changed since capture; stop and recapture')
 if info['buildConfig'].get('runtime')!='nodejs22' or info['buildConfig'].get('entryPoint')!=FUNCTION:
  raise RuntimeError('Runtime or entry point differs from reviewed capture')

def read_archive(archive):
 files={}
 with zipfile.ZipFile(archive) as z:
  if len(z.infolist())>2048 or sum(x.file_size for x in z.infolist())>200_000_000:
   raise RuntimeError('Unexpected archive size')
  for item in z.infolist():
   p=Path(item.filename)
   if p.is_absolute() or '..' in p.parts or '\\' in item.filename or stat.S_ISLNK(item.external_attr>>16):
    raise RuntimeError('Unsafe archive member')
   if item.is_dir():continue
   if item.filename in files:raise RuntimeError('Duplicate archive member')
   files[item.filename]=z.read(item)
 return files

def patch_engine(raw):
 if digest(raw)!=LIVE_SHA:raise RuntimeError('Live engine hash mismatch')
 text=raw.decode('utf8')
 for patch in json.loads(zlib.decompress(base64.b64decode(PATCH_DATA))):
  if text.count(patch['old'])!=1:raise RuntimeError('Anchor mismatch: '+patch['name'])
  text=text.replace(patch['old'],patch['next'],1)
 result=text.encode('utf8')
 if digest(result)!=EXPECTED_SHA:raise RuntimeError('Candidate engine hash mismatch')
 return result

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--apply',action='store_true',help='Deploy only commitRefereeCommand after all preparation checks pass')
 parser.add_argument('--check-engine',type=Path,help='Offline exact-overlay check; no gcloud access')
 args=parser.parse_args()
 if args.check_engine:
  result=patch_engine(args.check_engine.read_bytes());print('PASS exact live overlay:',digest(result));return
 os.umask(0o077)
 before=describe();require_baseline(before)
 work=Path(tempfile.mkdtemp(prefix='BXH815_release_',dir=Path.home()))
 print('Release directory:',work,flush=True)
 archive=work/'original-source.zip'
 command(['gcloud','storage','cp',SOURCE_URI,str(archive),'--project='+PROJECT,'--quiet'])
 original=read_archive(archive)
 for name,expected in DEPENDENCIES.items():
  if name not in original or digest(original[name])!=expected:raise RuntimeError('Dependency mismatch: '+name)
 if not {'index.js','package.json','engine/index.cjs'}<=set(original):raise RuntimeError('Source package incomplete')
 files=dict(original);files['engine/index.cjs']=patch_engine(original['engine/index.cjs'])
 stage=work/'candidate';stage.mkdir()
 rollback=work/'original';rollback.mkdir()
 for name,data in original.items():
  target=rollback/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 for name,data in files.items():
  target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 if [name for name in files if files[name]!=original[name]]!=['engine/index.cjs']:
  raise RuntimeError('Unexpected file change scope')
 runner=work/'verify-live-engine.cjs';runner.write_bytes(zlib.decompress(base64.b64decode(TEST_DATA)))
 subprocess.run(['node','--check',str(stage/'engine/index.cjs')],check=True)
 subprocess.run(['node',str(runner),str(stage/'engine/index.cjs')],check=True)
 record={'function':FUNCTION,'project':PROJECT,'baselineRevision':before['serviceConfig'].get('revision'),'baselineUpdateTime':before.get('updateTime'),'source':source(before),'archiveSha256':digest(archive.read_bytes()),'originalEngineSha256':LIVE_SHA,'candidateEngineSha256':EXPECTED_SHA,'changedFiles':['engine/index.cjs'],'preservedExportsPackageAndLockfile':True,'candidateFiles':{name:digest(data) for name,data in files.items()}}
 manifest=work/'release-record.json';manifest.write_text(json.dumps(record,indent=2)+'\n')
 deployment=['gcloud','functions','deploy',FUNCTION,'--gen2','--project='+PROJECT,'--region='+REGION,'--runtime=nodejs22','--entry-point='+FUNCTION,'--source='+str(stage),'--quiet','--format=value(state,serviceConfig.revision,updateTime)']
 print('READY: only four dispatch functions in engine/index.cjs change; source exports/configuration are preserved.',flush=True)
 if not args.apply:
  print('No deployment performed. Rerun this verified script with --apply to prepare and deploy against the same live baseline.');return
 latest=describe();require_baseline(latest)
 if latest.get('updateTime')!=before.get('updateTime') or configuration(latest)!=configuration(before):
  raise RuntimeError('Live configuration changed during preparation')
 for name,data in files.items():
  if (stage/name).is_symlink() or (stage/name).read_bytes()!=data:raise RuntimeError('Candidate changed after validation')
 rollback_command=[part if not part.startswith('--source=') else '--source='+str(rollback) for part in deployment]
 print('Rollback command if needed:',shlex.join(rollback_command),flush=True)
 print('Deploying only '+FUNCTION+' to '+PROJECT+'/'+REGION,flush=True)
 subprocess.run(deployment,check=True)
 after=describe()
 if after.get('state')!='ACTIVE':raise RuntimeError('Deployment did not reach ACTIVE')
 if configuration(after)!=configuration(before):
  raise RuntimeError('Function configuration differs after deployment; inspect release directory before further action')
 s=source(after)
 if not s.get('bucket') or not s.get('object') or not str(s.get('generation','')).isdigit():raise RuntimeError('Missing deployed immutable source')
 deployed=work/'deployed-source.zip'
 command(['gcloud','storage','cp','gs://'+s['bucket']+'/'+s['object']+'#'+str(s['generation']),str(deployed),'--project='+PROJECT,'--quiet'])
 deployed_files=read_archive(deployed)
 if deployed_files.get('engine/index.cjs')!=files['engine/index.cjs']:raise RuntimeError('Deployed engine readback mismatch')
 for name in ('index.js','package.json','package-lock.json'):
  if name in original and deployed_files.get(name)!=original[name]:raise RuntimeError('Protected source readback mismatch: '+name)
 record.update({'deployed':True,'verifiedEngineReadback':True,'configurationPreserved':True,'revision':after['serviceConfig'].get('revision'),'updateTime':after.get('updateTime'),'deployedSource':s})
 manifest.write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps({k:record[k] for k in ('deployed','verifiedEngineReadback','configurationPreserved','revision','updateTime','changedFiles')},indent=2),flush=True)
 print('Original source backup:',archive)

if __name__=='__main__':
 try:main()
 except (RuntimeError,subprocess.CalledProcessError,OSError,ValueError,zipfile.BadZipFile) as error:
  raise SystemExit('STOP: '+str(error)) from None
