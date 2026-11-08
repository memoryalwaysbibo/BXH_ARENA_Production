"""Check or cut over the three reviewed raffle callables in bxh-arena."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'bxh-arena'
LOCATION = f'projects/{PROJECT}/locations/asia-east1'
API = 'https://cloudfunctions.googleapis.com/v2/'
ORDER = ('previewTournamentRaffle', 'updateTournamentRaffleWinner', 'drawTournamentRaffle')
ARCHIVES = {
    'candidate': '38aec32a71b5eec7c507543eed2f013c61e9d31b504b2ffe76d635b0d4be2550',
    'compatibility': '534ca704c5800485392a8d310032f35b3fe6628efeb2205229b8c75f78f51dae',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def gcloud(*args):
    result = subprocess.run(['gcloud', *args], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError('gcloud command failed')
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('unexpected HTTP redirect')


class Cloud:
    def __init__(self):
        self.open = urllib.request.build_opener(NoRedirect()).open

    def request(self, method, resource, data=None):
        headers = {'Authorization': 'Bearer ' + gcloud('auth', 'print-access-token', '--quiet')}
        if data is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(data).encode()
        request = urllib.request.Request(API + resource, data=data, headers=headers, method=method)
        with self.open(request, timeout=60) as response:
            return json.load(response)

    def read(self, name):
        info = self.request('GET', f'{LOCATION}/functions/{name}')
        if (info.get('name') != f'{LOCATION}/functions/{name}' or info.get('state') != 'ACTIVE'
                or info.get('environment') != 'GEN_2' or info.get('buildConfig', {}).get('entryPoint') != name
                or info.get('serviceConfig', {}).get('allTrafficOnLatestRevision') is not True):
            raise RuntimeError(f'{name} is not the expected active Gen 2 callable')
        return info

    def source_hash(self, info):
        source = info['buildConfig']['source']['storageSource']
        bucket, obj, gen = source['bucket'], source['object'], str(source['generation'])
        if (not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,222}', bucket)
                or not obj or obj.startswith('/') or any(c in obj for c in '#\r\n*?[]')
                or not re.fullmatch(r'[1-9][0-9]{0,29}', gen)):
            raise RuntimeError('immutable source unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.zip'
            gcloud('storage', 'cp', f'gs://{bucket}/{obj}#{gen}', str(path), '--quiet')
            if path.stat().st_size > 16 * 1024 * 1024:
                raise RuntimeError('source archive too large')
            return sha(path.read_bytes())

    def upload(self, archive):
        target = self.request('POST', LOCATION + '/functions:generateUploadUrl', {})
        url = urllib.parse.urlsplit(target['uploadUrl'])
        if (url.scheme != 'https' or url.hostname != 'storage.googleapis.com'
                or url.username or url.password or url.port not in (None, 443)):
            raise RuntimeError('unexpected upload endpoint')
        request = urllib.request.Request(target['uploadUrl'], data=archive,
                                         headers={'Content-Type': 'application/zip'}, method='PUT')
        with self.open(request, timeout=120) as response:
            generation = response.headers.get('x-goog-generation', '')
        if not re.fullmatch(r'[1-9][0-9]{0,29}', generation):
            raise RuntimeError('upload did not return an immutable generation')
        source = target['storageSource']
        return {'bucket': source['bucket'], 'object': source['object'], 'generation': generation}

    def submit(self, name, source):
        resource = f'{LOCATION}/functions/{name}'
        body = {'name': resource, 'buildConfig': {'source': {'storageSource': source}}}
        operation = self.request('PATCH', resource + '?updateMask=buildConfig.source', body)
        operation_name = operation['name']
        if not re.fullmatch(re.escape(LOCATION) + r'/operations/[A-Za-z0-9_-]+', operation_name):
            raise RuntimeError('unexpected operation resource')
        return operation_name

    def wait(self, operation_name):
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            operation = self.request('GET', operation_name)
            if operation.get('done') is True:
                if 'error' in operation or 'response' not in operation:
                    raise RuntimeError('function update failed')
                return
            time.sleep(10)
        raise RuntimeError('operation still pending')


def service_settings(info):
    return {key: value for key, value in info['serviceConfig'].items() if key != 'revision'}


def cutover(cloud, mode, archive, baseline, emit, apply=False):
    if sha(archive) != ARCHIVES[mode]:
        raise RuntimeError('ZIP does not match the reviewed archive')
    by_name = {entry['name']: entry for entry in baseline['sources']}
    before = {}
    already_current = set()
    for name in ORDER:
        info = cloud.read(name)
        archive_hash = cloud.source_hash(info)
        if digest(cloud.read(name)) != digest(info):
            raise RuntimeError(f'{name} changed while checking its source')
        pin = by_name[name]
        if mode == 'candidate':
            if archive_hash != pin['sourceArchiveSha256'] or digest(info) != pin['metadataSha256']:
                raise RuntimeError(f'{name} differs from the reviewed production baseline')
        elif archive_hash not in {pin['sourceArchiveSha256'], *ARCHIVES.values()}:
            raise RuntimeError(f'{name} has an unreviewed source')
        if archive_hash == ARCHIVES[mode]:
            already_current.add(name)
        before[name] = info
    emit('BASELINE_CHECKED', mode=mode, functions=list(ORDER))
    if not apply:
        return
    for name in ORDER:
        if digest(cloud.read(name)) != digest(before[name]):
            raise RuntimeError(f'{name} changed after the preflight check')
        if name in already_current:
            emit('ALREADY_CURRENT', function=name)
            continue
        source = cloud.upload(archive)
        if digest(cloud.read(name)) != digest(before[name]):
            raise RuntimeError(f'{name} changed before submitting the update')
        emit('SUBMITTING', function=name)
        operation = cloud.submit(name, source)
        emit('OPERATION', function=name, operation=operation)
        cloud.wait(operation)
        after = cloud.read(name)
        if (service_settings(after) != service_settings(before[name])
                or after['buildConfig']['runtime'] != before[name]['buildConfig']['runtime']
                or cloud.source_hash(after) != ARCHIVES[mode]
                or digest(cloud.read(name)) != digest(after)):
            raise RuntimeError(f'{name} post-deployment readback failed')
        emit('VERIFIED', function=name, revision=after['serviceConfig']['revision'])
    emit('CUTOVER_VERIFIED', mode=mode)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=ARCHIVES, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-project')
    parser.add_argument('--journal', type=Path)
    args = parser.parse_args()
    if args.apply and (args.confirm_project != PROJECT or args.journal is None):
        parser.error('--apply requires --confirm-project bxh-arena and a new --journal file')
    baseline = json.loads((ROOT / 'release/buckets/raffle/live-provenance-20261107.json').read_text())
    archive = args.archive.read_bytes()
    if sha(archive) != ARCHIVES[args.mode]:
        raise SystemExit('ZIP does not match the reviewed archive')
    journal = args.journal.open('x', encoding='utf-8') if args.apply else None

    def emit(status, **fields):
        line = json.dumps({'status': status, **fields})
        if journal:
            journal.write(line + '\n')
            journal.flush()
        print(line, flush=True)

    try:
        cutover(Cloud(), args.mode, archive, baseline, emit, args.apply)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Cloud API returned HTTP {error.code}. Reconcile the journal before retrying.') from None
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        # Transport errors can include private paths or signed URLs.
        reason = str(error) if type(error) is RuntimeError else type(error).__name__
        raise SystemExit(f'{reason}. Reconcile the journal before retrying.') from None
    finally:
        if journal:
            journal.close()


if __name__ == '__main__':
    main()
