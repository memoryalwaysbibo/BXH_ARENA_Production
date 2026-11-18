#!/usr/bin/env python3
"""Apply PASS return as a scoped overlay on the audited live commitRefereeCommand."""
import argparse, base64, hashlib, json, os, shlex, stat, subprocess, tempfile, zipfile, zlib
from pathlib import Path

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'commitRefereeCommand'
GENERATION = '1794939464063954'
SOURCE_URI = 'gs://gcf-v2-sources-87261141693-asia-east1/commitRefereeCommand/function-source.zip#' + GENERATION
DEPENDENCIES = {'engine/court-retirement.cjs': '597add4bf231a629e62385d61f970610ab59638055b45f3dfc834f04a5b447b0', 'engine/match-utils.cjs': '60fdd13744d49acc2c28b42d12ff8c975841b8f6e891bd80cbd6832ef0c3fb53', 'engine/double-elimination.cjs': 'db9a6b0d815a10c2853c2d48794f297385b23798ce441e904c24246ddf32ab1c', 'engine/fault.cjs': '26da0500abd88622bf9f49555287dd5ed7a7e311f232dc5adae027fce6e25266'}
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


def overlay(original):
 plan=json.loads(zlib.decompress(base64.b64decode(PATCH_DATA)))
 files=dict(original)
 for name,expected in DEPENDENCIES.items():
  if name not in original or digest(original[name])!=expected:raise RuntimeError('Dependency mismatch: '+name)
 if not {'index.js','package.json','engine/index.cjs','core.cjs','event-staff-core.cjs'}<=set(original):
  raise RuntimeError('Source package incomplete')
 for name,patch in plan['replacements'].items():
  if name not in original or digest(original[name])!=patch['sha256']:
   raise RuntimeError('Audited source hash mismatch: '+name)
  text=original[name].decode('utf8')
  for item in patch['patches']:
   if text.count(item['old'])!=1:raise RuntimeError('Anchor mismatch: '+name+' / '+item['name'])
   text=text.replace(item['old'],item['next'],1)
  data=text.encode('utf8')
  if digest(data)!=patch['expectedSha256']:raise RuntimeError('Candidate hash mismatch: '+name)
  files[name]=data
 for name,text in plan['added'].items():
  if name in original:raise RuntimeError('Unexpected preexisting PASS module')
  files[name]=text.encode('utf8')
 expected=set(plan['replacements'])|set(plan['added'])
 changed={p for p in files if files[p]!=original.get(p)}
 if changed!=expected:raise RuntimeError('Unexpected file change scope')
 return files,sorted(changed)

def stage_files(folder,files):
 folder.mkdir()
 for name,data in files.items():
  target=folder/name
  target.parent.mkdir(parents=True,exist_ok=True)
  target.write_bytes(data)

def validate(work,original,files,changed):
 stage=work/'candidate';rollback=work/'original'
 stage_files(rollback,original);stage_files(stage,files)
 tests=json.loads(zlib.decompress(base64.b64decode(TEST_DATA)))
 for name,text in tests.items():(work/name).write_text(text)
 for name in changed:subprocess.run(['node','--check',str(stage/name)],check=True)
 check="const assert=require('node:assert/strict');for(const file of ['scoring-core.cjs','dispatch-core.cjs','engine/index.cjs']){const a=require(process.argv[1]+'/'+file),b=require(process.argv[2]+'/'+file);assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());}console.log('PASS existing module exports preserved');"
 subprocess.run(['node','-e',check,str(rollback),str(stage)],check=True)
 subprocess.run(['node',str(work/'verify-sequential.cjs'),str(stage/'engine/index.cjs')],check=True)
 env=dict(os.environ,BXH817_CANDIDATE=str(stage))
 subprocess.run(['node','--test',*[str(work/n) for n in tests if n!='verify-sequential.cjs']],check=True,env=env)
 return stage,rollback

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group()
 group.add_argument('--apply',action='store_true',help='Deploy the scoped overlay after all checks')
 group.add_argument('--check-source',type=Path,help='Offline validation of an unpacked source directory; no cloud access')
 args=parser.parse_args()
 os.umask(0o077)
 if args.check_source:
  root=args.check_source.resolve()
  if not root.is_dir():raise RuntimeError('Source directory missing')
  if any(p.is_symlink() for p in root.rglob('*')):raise RuntimeError('Symlink in source directory')
  original={p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()}
  work=Path(tempfile.mkdtemp(prefix='BXH817_offline_'))
  files,changed=overlay(original);validate(work,original,files,changed)
  print(json.dumps({'offline':True,'deployed':False,'changedFiles':changed,'candidate':str(work/'candidate')},indent=2));return
 before=describe();require_baseline(before)
 work=Path(tempfile.mkdtemp(prefix='BXH817_release_',dir=Path.home()))
 print('Release directory:',work,flush=True)
 archive=work/'original-source.zip'
 command(['gcloud','storage','cp',SOURCE_URI,str(archive),'--project='+PROJECT,'--quiet'])
 original=read_archive(archive);files,changed=overlay(original)
 stage,rollback=validate(work,original,files,changed)
 record={'function':FUNCTION,'project':PROJECT,'baselineRevision':before['serviceConfig'].get('revision'),'baselineUpdateTime':before.get('updateTime'),'source':source(before),'archiveSha256':digest(archive.read_bytes()),'changedFiles':changed,'candidateFiles':{n:digest(data) for n,data in files.items()},'preservedOtherFiles':True}
 manifest=work/'release-record.json';manifest.write_text(json.dumps(record,indent=2)+'\n')
 deployment=['gcloud','functions','deploy',FUNCTION,'--gen2','--project='+PROJECT,'--region='+REGION,'--runtime=nodejs22','--entry-point='+FUNCTION,'--source='+str(stage),'--quiet','--format=value(state,serviceConfig.revision,updateTime)']
 rollback_command=[part if not part.startswith('--source=') else '--source='+str(rollback) for part in deployment]
 print('READY: 3 existing files patched, 1 PASS module added; scoring flow and existing exports preserved.',flush=True)
 print('Rollback command if needed:',shlex.join(rollback_command),flush=True)
 if not args.apply:
  print('No deployment performed. Rerun this script with --apply to deploy against the same audited baseline.');return
 latest=describe();require_baseline(latest)
 if latest.get('updateTime')!=before.get('updateTime') or configuration(latest)!=configuration(before):
  raise RuntimeError('Live configuration changed during preparation')
 for name,data in files.items():
  if (stage/name).is_symlink() or (stage/name).read_bytes()!=data:raise RuntimeError('Candidate changed after validation')
 print('Deploying only '+FUNCTION+' to '+PROJECT+'/'+REGION,flush=True)
 subprocess.run(deployment,check=True)
 after=describe()
 if after.get('state')!='ACTIVE':raise RuntimeError('Deployment did not reach ACTIVE')
 if configuration(after)!=configuration(before):raise RuntimeError('Function configuration differs after deployment; inspect release directory')
 s=source(after)
 if not s.get('bucket') or not s.get('object') or not str(s.get('generation','')).isdigit():raise RuntimeError('Missing deployed immutable source')
 deployed=work/'deployed-source.zip'
 command(['gcloud','storage','cp','gs://'+s['bucket']+'/'+s['object']+'#'+str(s['generation']),str(deployed),'--project='+PROJECT,'--quiet'])
 deployed_files=read_archive(deployed)
 for name in changed+['index.js','package.json','package-lock.json']:
  if name in files and deployed_files.get(name)!=files[name]:raise RuntimeError('Deployed source readback mismatch: '+name)
 record.update({'deployed':True,'verifiedSourceReadback':True,'configurationPreserved':True,'revision':after['serviceConfig'].get('revision'),'updateTime':after.get('updateTime'),'deployedSource':s})
 manifest.write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps({k:record[k] for k in ('deployed','verifiedSourceReadback','configurationPreserved','revision','updateTime','changedFiles')},indent=2),flush=True)
 print('Original source backup:',archive)

if __name__=='__main__':
 try:main()
 except (RuntimeError,subprocess.CalledProcessError,OSError,ValueError,zipfile.BadZipFile) as error:
  raise SystemExit('STOP: '+str(error)) from None
