#!/usr/bin/env python3
"""Private, read-only three-way PTN integration review; never a deploy bundle."""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import zipfile

FRONT_BASE = '41ab81f1bc57483c4529c6bdfb31842a5450fb5f'
FRONT_HEAD = 'fd75f38f5b5ec0e7114e7bbc530b44092252eeef'
BACK_BASE = '8e4886cf08edfe40b5d677d96c2b06417da2fdb9'
BACK_HEAD = '1f6573b4aef69366120b3fed811d2702d226e80b'
SETTLEMENT_HEAD = 'afde2fc515c0df5f06fd7724726e4433365ab696'
SETTLEMENT_PORT = 'release/commerce/tests/ptn-settlement-source-port.test.cjs'

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
        # An audited dependency present in both Git refs but absent from the
        # deployed archive is not evidence that it is safe to preserve live.
        if live is None and candidate is not None:
            return 'conflict', None
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

# The one manually reviewed conflict is tied to the exact audited source bytes.
# This produces private review output only, never a deployment bundle.
COMMERCE_LIVE = '20c05d56971d6dd76a4cd38beb47d6eb7a64963bc7a9ebf9d3921425e747a432'
COMMERCE_CANDIDATE = '045a7ee1a39b2b0c1b938c7916455f2b30b56d4c04674b89ecfc7ac1640d44c7'
COMMERCE_CONFLICT = 'bbd2da2ee4403be437d0088d1073d221fd767084b50bf087393047763630ab2c'
COMMERCE_RESOLVED = '554376ba19b01b05187e93fe2ea859e4e843f00854688c80aa289f42cc050669'
COMMERCE_BLOCKS = re.compile(
    rb'^<<<<<<< live\.cjs\n(.*?)^\|{7} base\.cjs\n(.*?)'
    rb'^=======\n(.*?)^>>>>>>> candidate\.cjs\n', re.M | re.S)


def resolve_commerce_blocks(source):
    matches = list(COMMERCE_BLOCKS.finditer(source))
    if len(matches) != 5 or sha(b''.join(m.group(0) for m in matches)) != COMMERCE_CONFLICT:
        raise RuntimeError('commerce conflict blocks changed; manual review required')
    a = [m.groups() for m in matches]
    replacements = [
        a[0][0] + a[0][2].split(b'\n', 1)[1],
        a[1][0] + a[1][2],
        a[2][0].replace(b'}));', b'})).filter(Boolean);'),
        a[3][2].rsplit(b'    if(p.status', 1)[0] + a[3][0],
        a[4][2].rsplit(b"    if(p.delivery.kind==='ticket')", 1)[0] + a[4][0],
    ]
    for m, replacement in reversed(list(zip(matches, replacements))):
        source = source[:m.start()] + replacement + source[m.end():]
    if re.search(rb'^(<<<<<<<|\|{7}|=======|>>>>>>>)', source, re.M):
        raise RuntimeError('commerce conflict markers remain')
    return source


def resolve_known_commerce(live, base, candidate):
    if sha(live) != COMMERCE_LIVE or sha(candidate) != COMMERCE_CANDIDATE or base is None:
        return None
    with tempfile.TemporaryDirectory(prefix='ptn-commerce-resolution-') as directory:
        paths = [Path(directory) / name for name in ('live.cjs', 'base.cjs', 'candidate.cjs')]
        for path, content in zip(paths, (live, base, candidate)):
            path.write_bytes(content)
        merge = subprocess.run(
            ['git', 'merge-file', '-p', '--diff3', '-L', 'live.cjs', '-L', 'base.cjs',
             '-L', 'candidate.cjs', *map(str, paths)],
            capture_output=True)
        if merge.returncode != 5 or merge.stderr:
            raise RuntimeError('unexpected commerce merge result; manual review required')
        resolved = resolve_commerce_blocks(merge.stdout)
        if sha(resolved) != COMMERCE_RESOLVED:
            raise RuntimeError('resolved commerce digest differs from reviewed candidate')
        path = Path(directory) / 'service.resolved.cjs'
        path.write_bytes(resolved)
        subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        return resolved


def settlement_manifest(source):
    # The pinned test file declares JSON literals. Parse data only; never execute JS.
    decoded = source.decode('utf-8')
    result = []
    for name in ('hashes', 'edits'):
        marker = '\nconst ' + name + '='
        if decoded.count(marker) != 1:
            raise RuntimeError('missing or ambiguous settlement manifest: ' + name)
        tail = decoded.split(marker, 1)[1].lstrip()
        value, end = json.JSONDecoder().raw_decode(tail)
        if not isinstance(value, dict) or not tail[end:].lstrip().startswith(';'):
            raise RuntimeError('invalid settlement manifest: ' + name)
        result.append(value)
    return tuple(result)


def settlement_patch(live, historical_hash, declared_hash, edits):
    if live is None or sha(live) != historical_hash or historical_hash != declared_hash:
        raise RuntimeError('settlement source drift; no candidate produced')
    if not isinstance(edits, list) or not edits:
        raise RuntimeError('missing settlement edits')
    candidate = live
    for pair in edits:
        if (not isinstance(pair, list) or len(pair) != 2 or
                not all(isinstance(part, str) for part in pair) or not pair[0]):
            raise RuntimeError('invalid settlement edit')
        before, after = (part.encode('utf-8') for part in pair)
        if candidate.count(before) != 1:
            raise RuntimeError('settlement edit anchor not unique')
        candidate = candidate.replace(before, after, 1)
    return candidate


def review_settlement(z, paths, row, manifest, historical, output):
    hashes, edits = manifest
    if set(hashes) != set(paths) or set(edits) != set(paths):
        raise RuntimeError('unexpected settlement manifest file set')
    proposals = {}
    report = {}
    for path in paths:
        live = member(z, path)
        expected = row['files'][path]
        if (sha(live) != expected['liveSha256'] or
                expected['historicalSha256'] != historical[path] or
                expected['historicalMatch'] is not True):
            raise RuntimeError('settlement audit mismatch: ' + path)
        candidate = settlement_patch(live, historical[path], hashes[path], edits[path])
        proposals[path] = candidate
        report[path] = {'status': 'settlement-port-review', 'liveSha256': sha(live),
                        'reviewSha256': sha(candidate), 'editCount': len(edits[path])}
    # All three inputs must pass before writing any settlement review files.
    for path, candidate in proposals.items():
        target = output / 'ladderAutoSettlement' / path
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        target.write_bytes(candidate)
    return report


def verify_review_outputs(output, reports):
    """Verify all proposed bytes and reject stray files before reporting."""
    counts = {}
    expected = set()
    for name, files in reports.items():
        for path, entry in files.items():
            status = entry['status']
            counts[status] = counts.get(status, 0) + 1
            target = output / name / path
            if 'reviewSha256' in entry:
                if status not in ('new-module-review', 'merged-review', 'settlement-port-review',
                                  'commerce-conflict-resolved-review'):
                    raise RuntimeError('unexpected proposed file status')
                if not target.is_file() or target.is_symlink() or sha(target.read_bytes()) != entry['reviewSha256']:
                    raise RuntimeError('review output hash mismatch: ' + name + '/' + path)
                expected.add(target.relative_to(output))
            elif status not in ('preserve-live', 'already-present', 'conflict'):
                raise RuntimeError('missing proposed file hash: ' + name + '/' + path)
    actual = {p.relative_to(output) for p in output.rglob('*') if p.is_file() or p.is_symlink()}
    if actual != expected:
        raise RuntimeError('unexpected or missing review files')
    return counts


def rollback_inventory(initial, rows):
    # Reference-only evidence. This does not prove a rollback can be deployed.
    return {
        'status': 'SOURCE_REFERENCES_ONLY_NOT_ROLLBACK_VALIDATED',
        'productionWrites': 0,
        'functions': {
            name: {'bucket': bucket, 'object': obj, 'generation': generation,
                   'archiveSha256': rows[name]['archiveSha256']}
            for name, (bucket, obj, generation) in initial.items()
        }
    }


def self_test():
    assert port(b'live', b'old', b'old') == ('preserve-live', None)
    assert port(None, b'dependency', b'dependency') == ('conflict', None)
    assert port(None, None, b'new') == ('new-module-review', b'new')
    assert port(b'other', None, b'new') == ('conflict', None)
    assert port(b'new', b'old', b'new') == ('already-present', None)
    assert port(None, b'old', b'new') == ('conflict', None)
    assert port(b'live\n', b'old\n', b'candidate\n') == ('conflict', None)
    base = b'one\na\nb\nc\nd\ne\nf\nlast\n'
    live = base.replace(b'one', b'production')
    candidate = base.replace(b'last', b'expansion')
    assert port(live, base, candidate) == ('merged-review', live.replace(b'last', b'expansion'))
    manifest = settlement_manifest(b'\nconst hashes={"a":"hash"};\nconst edits={"a":[["x","y"]]};\n')
    assert manifest == ({"a": "hash"}, {"a": [["x", "y"]]})
    live = b'alpha beta'
    assert settlement_patch(live, sha(live), sha(live), [['beta', 'gamma']]) == b'alpha gamma'
    for args in ((live, 'wrong', sha(live), [['beta', 'gamma']]),
                 (b'beta beta', sha(b'beta beta'), sha(b'beta beta'), [['beta', 'gamma']]),
                 (live, sha(live), sha(live), [['absent', 'gamma']])):
        try:
            settlement_patch(*args)
        except RuntimeError:
            pass
        else:
            raise AssertionError('unsafe settlement edit accepted')
    with tempfile.TemporaryDirectory(prefix='ptn-review-check-') as directory:
        output = Path(directory)
        target = output / 'fn' / 'candidate.js'
        target.parent.mkdir()
        target.write_bytes(b'candidate')
        report = {'fn': {'candidate.js': {'status': 'merged-review', 'reviewSha256': sha(b'candidate')},
                         'conflict.js': {'status': 'conflict'}}}
        assert verify_review_outputs(output, report) == {'merged-review': 1, 'conflict': 1}
        for invalid in ('changed', 'stray', 'missing'):
            target.write_bytes(b'candidate')
            stray = output / 'fn' / 'conflict.js'
            if invalid == 'changed':
                target.write_bytes(b'changed')
            elif invalid == 'stray':
                stray.write_bytes(b'unexpected')
            else:
                target.unlink()
            try:
                verify_review_outputs(output, report)
            except RuntimeError:
                pass
            else:
                raise AssertionError('invalid review output accepted: ' + invalid)
            if stray.exists():
                stray.unlink()
    inventory = rollback_inventory({'fn': ('bucket', 'object', '123')},
                                   {'fn': {'archiveSha256': 'archive-hash'}})
    assert inventory['functions']['fn'] == {'bucket': 'bucket', 'object': 'object',
                                            'generation': '123', 'archiveSha256': 'archive-hash'}
    assert inventory['status'] == 'SOURCE_REFERENCES_ONLY_NOT_ROLLBACK_VALIDATED'
    # Test the complete settlement review, not only its single-file patch helper.
    # A mismatch in the last input must not leave any partial candidate files.
    inputs = {'first.js': b'alpha beta', 'last.js': b'gamma delta'}
    historical = {path: sha(data) for path, data in inputs.items()}
    declared = dict(historical)
    edits = {'first.js': [['beta', 'new']], 'last.js': [['delta', 'new']]}
    rows = {'files': {path: {'liveSha256': digest, 'historicalSha256': digest,
                            'historicalMatch': True}
                      for path, digest in historical.items()}}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as z:
        for path, data in inputs.items():
            z.writestr(path, data)
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory(prefix='ptn-settlement-review-') as directory:
        output = Path(directory)
        wrong = dict(declared, **{'last.js': 'wrong'})
        try:
            review_settlement(z, list(inputs), rows, (wrong, edits), historical, output)
        except RuntimeError:
            assert not list(output.rglob('*')), 'partial settlement output after mismatch'
        else:
            raise AssertionError('settlement source mismatch accepted')
        result = review_settlement(z, list(inputs), rows, (declared, edits), historical, output)
        assert verify_review_outputs(output, {'ladderAutoSettlement': result}) == {'settlement-port-review': 2}
        assert (output / 'ladderAutoSettlement' / 'first.js').read_bytes() == b'alpha new'
        assert (output / 'ladderAutoSettlement' / 'last.js').read_bytes() == b'gamma new'
    assert resolve_known_commerce(b'changed', b'base', b'candidate') is None
    try:
        resolve_commerce_blocks(b'<<<<<<< live.cjs\nchanged\n')
    except RuntimeError:
        pass
    else:
        raise AssertionError('unknown commerce conflict accepted')
    with tempfile.TemporaryDirectory(prefix='ptn-commerce-review-check-') as directory:
        output = Path(directory)
        target = output / 'commerceService' / 'service.cjs'
        target.parent.mkdir()
        target.write_bytes(b'candidate')
        report = {'commerceService': {'service.cjs': {
            'status': 'commerce-conflict-resolved-review', 'reviewSha256': sha(b'candidate')}}}
        assert verify_review_outputs(output, report) == {'commerce-conflict-resolved-review': 1}
    print('26 review assertions passed; no cloud access')

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
                              (args.backend_root, BACK_BASE, BACK_HEAD),
                              (args.backend_root, SETTLEMENT_HEAD, SETTLEMENT_HEAD)):
        for ref in (base, head):
            if git(root, 'rev-parse', ref + '^{commit}').decode().strip() != ref:
                raise RuntimeError('missing pinned commit')
    manifest = settlement_manifest(blob(args.backend_root, SETTLEMENT_HEAD, SETTLEMENT_PORT))
    initial = {name: audit.binding(name) for name in audit.TARGETS}
    if any(src[2] != rows[name]['generation'] for name, src in initial.items()):
        raise RuntimeError('live generation changed; refresh audit')
    output = Path(tempfile.mkdtemp(prefix='bxh-expansion-threeway-'))
    reports = {}
    for name, paths in audit.TARGETS.items():
        row = rows[name]
        if set(row['files']) != set(paths):
            raise RuntimeError('unexpected audit file set: ' + name)
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
            if name == 'ladderAutoSettlement':
                reports[name] = review_settlement(z, paths, row, manifest,
                                                  audit.HISTORICAL[name], output)
                continue
            for path in paths:
                repo_path = path if front else 'release/commerce/functions/' + path
                live, base, candidate = member(z, path), blob(root, base_ref, repo_path), blob(root, head_ref, repo_path)
                expected = row['files'][path]
                if sha(live) != expected['liveSha256'] or sha(candidate) != expected['candidateSha256']:
                    raise RuntimeError('audited file hash mismatch: ' + name + '/' + path)
                status, proposed = port(live, base, candidate)
                if status == 'conflict' and name == 'commerceService' and path == 'service.cjs':
                    resolved = resolve_known_commerce(live, base, candidate)
                    if resolved is not None:
                        status, proposed = 'commerce-conflict-resolved-review', resolved
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
    counts = verify_review_outputs(output, reports)
    inventory = rollback_inventory(initial, rows)
    (output / 'rollback-source-inventory.json').write_text(json.dumps(inventory, indent=2))
    result = {'status': 'THREEWAY_REVIEW_ONLY_NOT_DEPLOYABLE', 'productionWrites': 0,
              'privateReviewDir': str(output), 'functions': reports,
              'reviewRefs': {'frontBase': FRONT_BASE, 'frontHead': FRONT_HEAD,
                             'backendBase': BACK_BASE, 'backendHead': BACK_HEAD,
                             'settlementHead': SETTLEMENT_HEAD},
              'reviewStatusCounts': counts, 'conflictCount': counts.get('conflict', 0),
              'rollbackSourceInventory': str(output / 'rollback-source-inventory.json'),
              'rollbackValidated': False}
    (output / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
