#!/usr/bin/env python3
"""Private, read-only three-way PTN integration review; never a deploy bundle."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

FRONT_BASE = 'a91fe57578e1deb74a76a5d19aada1e59ef19b12'
FRONT_HEAD = '9b396ba133f569b43316ae88b3a7384e7207cebf'
BACK_BASE = '0bf2caba485920f56e65084adf23d44df4006b97'
BACK_HEAD = 'bb5cecec5053bbea77d0c3265b9abb62b73c8598'

def sha(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def blob(root, ref, path):
    if not git(root, 'ls-tree', ref, '--', path).strip():
        return None
    return git(root, 'show', ref + ':' + path)

def member(z, path):
    matches = [n for n in z.namelist() if 'node_modules/' not in n
               and (n == path or n.endswith('/' + path))]
    if len(matches) > 1:
        raise RuntimeError('ambiguous member: ' + path)
    return z.read(matches[0]) if matches else None

def port(live, base, candidate):
    # An unchanged PR file must never replace a different production file.
    if base == candidate:
        return 'preserve-live', None
    if live == candidate:
        return 'already-present', None
    if base is None:
        return ('new-module-review', candidate) if live is None else ('conflict', None)
    if live is None or candidate is None:
        return 'conflict', None
    with tempfile.TemporaryDirectory(prefix='ptn-merge-') as directory:
        paths = [Path(directory) / n for n in ('live', 'base', 'candidate')]
        for p, data in zip(paths, (live, base, candidate)):
            p.write_bytes(data)
        result = subprocess.run(['git', 'merge-file', '-p', *map(str, paths)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode < 0 or result.returncode > 127 or result.stderr:
        raise RuntimeError('merge-file failed')
    if result.returncode:
        return 'conflict', None
    return 'merged-review', result.stdout

def self_test():
    assert port(b'live', b'old', b'old') == ('preserve-live', None)
    assert port(None, None, b'new') == ('new-module-review', b'new')
    assert port(b'other', None, b'new') == ('conflict', None)
    assert port(b'new', b'old', b'new') == ('already-present', None)
    assert port(None, b'old', b'new') == ('conflict', None)
    assert port(b'live\n', b'old\n', b'candidate\n') == ('conflict', None)
    base = b'one\na\nb\nc\nd\ne\nf\nlast\n'
    live = base.replace(b'one', b'production')
    candidate = base.replace(b'last', b'expansion')
    assert port(live, base, candidate) == ('merged-review', live.replace(b'last', b'expansion'))
    print('7 three-way review assertions passed; no cloud access')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test', action='store_true')
    p.add_argument('--audit', type=Path)
    p.add_argument('--front-root', type=Path)
    p.add_argument('--backend-root', type=Path)
    args = p.parse_args()
    os.umask(0o077)
    if args.self_test:
        self_test()
        return
    if not all((args.audit, args.front_root, args.backend_root)):
        p.error('audit and both checkout roots required')
    import PTN_expansion_source_audit as audit
    previous = json.loads(args.audit.read_text())
    rows = {r['function']: r for r in previous['functions']}
    if (previous['status'] != 'READ_ONLY_SOURCE_AUDIT' or previous['productionWrites'] != 0
            or len(previous['functions']) != len(audit.TARGETS) or set(rows) != set(audit.TARGETS)):
        raise RuntimeError('incomplete audit')
    for root, base, head in ((args.front_root, FRONT_BASE, FRONT_HEAD),
                              (args.backend_root, BACK_BASE, BACK_HEAD)):
        for ref in (base, head):
            if git(root, 'rev-parse', ref + '^{commit}').decode().strip() != ref:
                raise RuntimeError('missing pinned commit')
    initial = {name: audit.binding(name) for name in audit.TARGETS}
    if any(src[2] != rows[name]['generation'] for name, src in initial.items()):
        raise RuntimeError('live generation changed; refresh audit')
    output = Path(tempfile.mkdtemp(prefix='bxh-expansion-threeway-'))
    reports = {}
    for name, paths in audit.TARGETS.items():
        row = rows[name]
        if set(row['files']) != set(paths):
            raise RuntimeError('unexpected audit file set: ' + name)
        if name == 'ladderAutoSettlement':
            reports[name] = {'status': 'settlement-port-still-required'}
            continue
        bucket, obj, generation = initial[name]
        archive = subprocess.check_output(['gcloud', 'storage', 'cat', f'gs://{bucket}/{obj}#{generation}'])
        if sha(archive) != row['archiveSha256']:
            raise RuntimeError('archive hash changed: ' + name)
        front = name.startswith('registration')
        root, base_ref, head_ref = ((args.front_root, FRONT_BASE, FRONT_HEAD) if front
                                   else (args.backend_root, BACK_BASE, BACK_HEAD))
        reports[name] = {}
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            if len(z.namelist()) != len(set(z.namelist())):
                raise RuntimeError('duplicate archive members')
            for path in paths:
                repo_path = path if front else 'release/commerce/functions/' + path
                live, base, candidate = member(z, path), blob(root, base_ref, repo_path), blob(root, head_ref, repo_path)
                expected = row['files'][path]
                if sha(live) != expected['liveSha256'] or sha(candidate) != expected['candidateSha256']:
                    raise RuntimeError('audited file hash mismatch: ' + name + '/' + path)
                status, proposed = port(live, base, candidate)
                entry = {'status': status, 'liveSha256': sha(live), 'baseSha256': sha(base),
                         'candidateSha256': sha(candidate)}
                if proposed is not None:
                    target = output / name / path
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    target.write_bytes(proposed)
                    entry['reviewSha256'] = sha(proposed)
                reports[name][path] = entry
    if any(audit.binding(name) != src for name, src in initial.items()):
        raise RuntimeError('source changed during review; discard private output')
    result = {'status': 'THREEWAY_REVIEW_ONLY_NOT_DEPLOYABLE', 'productionWrites': 0,
              'privateReviewDir': str(output), 'functions': reports}
    (output / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
