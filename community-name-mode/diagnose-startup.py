#!/usr/bin/env python3
"""Compare baseline/candidate local Node 22 startup and read Cloud Run settings."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import tempfile
import tarfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import zipfile

MANIFEST_SHA = '8b8072bbc7760ed2f5d77c9670d94b12c9b5b2e8d71a7b6e439f7af6b1b41abf'
REVISIONS = ('familyregistration-00042-wor','familyregistration-00043-xet')

def need(value, reason):
    if not value:
        raise ValueError(reason)

def emit(status, **fields):
    print(json.dumps({'status':status, **fields}),flush=True)

def sha(value):
    return hashlib.sha256(value).hexdigest()

def run(*args, cwd=None, timeout=180):
    return subprocess.check_output(list(args),cwd=cwd,timeout=timeout).decode().strip()

def download_node22(work, opener=urlopen, machine=None):
    arch = {'x86_64':'x64','amd64':'x64','aarch64':'arm64','arm64':'arm64'}.get(machine or platform.machine())
    need(platform.system() == 'Linux' and arch, 'UNSUPPORTED_NODE_PLATFORM')
    base = 'https://nodejs.org/download/release/'
    def get(url):
        response = opener(Request(url,headers={'User-Agent':'BXH-startup-diagnostic/2'}),timeout=120)
        parsed = urlsplit(response.geturl())
        need(parsed.scheme == 'https' and parsed.hostname == 'nodejs.org'
             and parsed.port in (None,443), 'NODE_DOWNLOAD_ORIGIN')
        return response
    with get(base+'latest-v22.x/SHASUMS256.txt') as response:
        sums = response.read(128*1024).decode('utf8')
    matches = []
    pattern = re.compile(r'([a-f0-9]{64})\s+(node-(v22\.[0-9]+\.[0-9]+)-linux-'+arch+r'\.tar\.xz)')
    for line in sums.splitlines():
        found = pattern.fullmatch(line.strip())
        if found:
            matches.append(found.groups())
    need(len(matches) == 1, 'NODE22_CHECKSUM_ENTRY')
    expected,filename,version = matches[0]
    archive = work/'node22.tar.xz'
    checksum = hashlib.sha256()
    count = 0
    with get(base+version+'/'+filename) as response, archive.open('wb') as output:
        while True:
            chunk = response.read(1024*1024)
            if not chunk:
                break
            count += len(chunk)
            need(count <= 150*1024*1024, 'NODE_ARCHIVE_TOO_LARGE')
            checksum.update(chunk);output.write(chunk)
    need(checksum.hexdigest() == expected, 'NODE22_DOWNLOAD_CHECKSUM_MISMATCH')
    node = work/'runtime/bin/node'
    node.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:xz') as tar:
        entry = tar.getmember(filename[:-7]+'/bin/node')
        need(entry.isfile() and 0 < entry.size < 200*1024*1024, 'NODE_BINARY_ENTRY')
        with tar.extractfile(entry) as source, node.open('wb') as output:
            shutil.copyfileobj(source,output)
    node.chmod(0o700)
    archive.unlink()
    emit('NODE22_OFFICIAL_BINARY_VERIFIED',version=version,sha256=expected)
    return node

def extract(path, output, expected):
    raw = path.read_bytes()
    need(sha(raw) == expected, 'SOURCE_HASH_CHANGED')
    seen = set()
    with zipfile.ZipFile(path) as z:
        need(sum(i.file_size for i in z.infolist()) < 200*1024*1024,'SOURCE_TOO_LARGE')
        for entry in z.infolist():
            p = PurePosixPath(entry.filename)
            need(not p.is_absolute() and '..' not in p.parts
                 and not stat.S_ISLNK(entry.external_attr >> 16),'UNSAFE_ARCHIVE_PATH')
            if entry.is_dir():
                continue
            need(str(p) not in seen,'DUPLICATE_ARCHIVE_PATH')
            seen.add(str(p))
            target = output/str(p)
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(z.read(entry))

def safe_revision(value):
    spec = value.get('spec',{})
    containers = spec.get('containers',[])
    container = containers[0] if containers else {}
    env = {r['name']:r for r in container.get('env',[]) if 'name' in r}
    allowed_env = ('FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE','PORT','NODE_ENV','NODE_OPTIONS',
                   'GOOGLE_FUNCTION_TARGET','GOOGLE_FUNCTION_SIGNATURE_TYPE','GOOGLE_RUNTIME')
    annotations = value.get('metadata',{}).get('annotations',{})
    return {'revision':value.get('metadata',{}).get('name'),
        'image':container.get('image'),'command':container.get('command'),'args':container.get('args'),
        'resources':container.get('resources'),'startupProbe':container.get('startupProbe'),
        'environmentNames':sorted(env),
        'startupEnvironment':{k:env[k].get('value') for k in allowed_env if k in env},
        'runtimeAnnotations':{k:v for k,v in annotations.items() if k in (
            'run.googleapis.com/base-images','run.googleapis.com/startup-cpu-boost',
            'run.googleapis.com/execution-environment','run.googleapis.com/cpu-throttling')},
        'conditions':value.get('status',{}).get('conditions',[])}

def cloud_settings():
    raw = []
    for revision in REVISIONS:
        try:
            info = json.loads(run('gcloud','run','revisions','describe',revision,
                '--region=asia-east1','--project=bxh-arena','--format=json',timeout=60))
            raw.append(info)
            emit('CLOUD_REVISION_SETTINGS',**safe_revision(info))
        except (subprocess.SubprocessError,OSError,ValueError):
            emit('CLOUD_REVISION_READ_UNAVAILABLE',revision=revision)
    if len(raw) == 2:
        def env(value):
            return {r['name']:r for r in value.get('spec',{}).get('containers',[{}])[0].get('env',[])}
        before,after = map(env,raw)
        emit('CLOUD_CHANGED_ENVIRONMENT_NAMES',names=sorted(k for k in set(before)|set(after)
             if before.get(k) != after.get(k)))

def listen(node, framework, source, label, work):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    env = {**os.environ,'GCLOUD_PROJECT':'bxh-arena','GOOGLE_CLOUD_PROJECT':'bxh-arena',
           'FUNCTION_TARGET':'familyRegistration','FUNCTION_SIGNATURE_TYPE':'http','PORT':str(port)}
    log = work/(label+'-startup.log')
    args = [str(node),str(framework),'--source='+str(source),
            '--target=familyRegistration','--signature-type=http','--port='+str(port)]
    ready = False
    rss = None
    exit_before_stop = None
    with log.open('wb') as stream:
        process = subprocess.Popen(args,cwd=source,env=env,stdout=stream,stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            deadline = time.monotonic()+25
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.3):
                        ready = True
                    break
                except OSError:
                    time.sleep(.2)
            if ready:
                status = Path('/proc')/str(process.pid)/'status'
                if status.is_file():
                    rss = next((line.split(':',1)[1].strip() for line in status.read_text().splitlines()
                                if line.startswith('VmRSS:')),None)
        finally:
            exit_before_stop = process.poll()
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
    emit('NODE22_FRAMEWORK_LISTEN_RESULT',source=label,listening=ready,rss=rss,
         exitCode=exit_before_stop,stoppedAfterProbe=exit_before_stop is None)
    print(log.read_text(errors='replace')[-16000:],flush=True)
    return ready

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('staging',type=Path)
    args = parser.parse_args()
    root = args.staging.resolve()
    data = (root/'manifest.json').read_bytes()
    need(sha(data) == MANIFEST_SHA,'STAGING_MANIFEST_CHANGED')
    manifest = json.loads(data)
    row = manifest['writers']['familyRegistration']
    cloud_settings()
    # All installs and startup checks stay in a fresh local diagnostic folder.
    with tempfile.TemporaryDirectory(prefix='BXH-784-node22-',dir=Path.home()) as temp:
        work = Path(temp)
        baseline,candidate = work/'baseline',work/'candidate'
        extract(root/'familyRegistration/original.zip',baseline,row['originalSha256'])
        extract(root/'familyRegistration/candidate.zip',candidate,row['candidateSha256'])
        node = download_node22(work)
        version = run(str(node),'--version')
        need(version.startswith('v22.'),'NODE22_NOT_SELECTED')
        emit('EXPLICIT_NODE_VERSION',version=version)
        subprocess.check_call(['npm','install','--prefix',str(candidate),'--ignore-scripts',
            '--no-audit','--no-fund'],timeout=300)
        (baseline/'node_modules').symlink_to(candidate/'node_modules',target_is_directory=True)
        framework_root = work/'framework'
        subprocess.check_call(['npm','install','--prefix',str(framework_root),'--no-package-lock',
            '--ignore-scripts','--no-audit','--no-fund','@google-cloud/functions-framework'],timeout=300)
        package = framework_root/'node_modules/@google-cloud/functions-framework/package.json'
        cfg = json.loads(package.read_text())
        framework = package.parent/cfg['bin']['functions-framework']
        need(framework.is_file(),'FRAMEWORK_CLI_NOT_FOUND')
        emit('LOCAL_FRAMEWORK_VERSION',version=cfg['version'])
        outcomes = {label:listen(node,framework,path,label,work)
                    for label,path in [('baseline',baseline),('candidate',candidate)]}
        emit('LOCAL_STARTUP_COMPARISON',nodeVersion=version,results=outcomes,cloudWrites=0)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('STARTUP_DIAGNOSIS_STOPPED',reason=str(error) if type(error) is ValueError else type(error).__name__,cloudWrites=0)
        raise SystemExit(1) from None
