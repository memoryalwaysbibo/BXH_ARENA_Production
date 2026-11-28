#!/usr/bin/env python3
"""Read-only, pinned live-to-candidate review diffs. NOT deployment patches.
Private local output only; stdout contains metadata, not source text.
"""
import argparse
import difflib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def source_member(z, path):
    matches = [n for n in z.namelist() if 'node_modules/' not in n
               and (n == path or n.endswith('/' + path))]
    if len(matches) > 1:
        raise RuntimeError('ambiguous archive member: ' + path)
    return z.read(matches[0]) if matches else None


def compare(z, path, expected, candidate, out):
    live = source_member(z, path)
    if sha(live) != expected['liveSha256']:
        raise RuntimeError('live file differs from audited hash: ' + path)
    if expected['candidateSha256'] is None:
        return {'status': 'candidate-not-audited'}
    if candidate is None or sha(candidate) != expected['candidateSha256']:
        raise RuntimeError('candidate differs from audited hash: ' + path)
    if live == candidate:
        return {'status': 'identical'}
    if live is None:
        return {'status': 'new-candidate-module', 'candidateLines': len(candidate.splitlines())}
    old, new = live.decode('utf-8').splitlines(keepends=True), candidate.decode('utf-8').splitlines(keepends=True)
    diff = list(difflib.unified_diff(old, new, 'live/' + path, 'candidate/' + path))
    out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    out.write_text(''.join(diff), encoding='utf-8')
    return {'status': 'review-required', 'diffFile': str(out),
            'addedLines': sum(s.startswith('+') for s in diff[2:]),
            'removedLines': sum(s.startswith('-') for s in diff[2:])}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit', type=Path, required=True)
    p.add_argument('--front-root', type=Path, required=True)
    p.add_argument('--backend-root', type=Path, required=True)
    args = p.parse_args()
    import PTN_expansion_source_audit as audit
    prior = json.loads(args.audit.read_text())
    rows = {r['function']: r for r in prior['functions']}
    if (prior['status'] != 'READ_ONLY_SOURCE_AUDIT' or prior['productionWrites'] != 0
            or len(prior['functions']) != len(audit.TARGETS) or set(rows) != set(audit.TARGETS)):
        raise RuntimeError('incomplete source audit')
    initial = {name: audit.binding(name) for name in audit.TARGETS}
    if any(src[2] != rows[name]['generation'] for name, src in initial.items()):
        raise RuntimeError('live generation changed; refresh source audit')
    os.umask(0o077)
    output = Path(tempfile.mkdtemp(prefix='bxh-expansion-review-'))
    reports = {}
    for name, paths in audit.TARGETS.items():
        row = rows[name]
        if set(row['files']) != set(paths):
            raise RuntimeError('unexpected audit file set: ' + name)
        if name == 'ladderAutoSettlement':
            reports[name] = {path: {'status': 'candidate-not-audited'} for path in paths}
            continue
        root = args.front_root if name.startswith('registration') else args.backend_root / 'release/commerce/functions'
        bucket, obj, generation = initial[name]
        archive = subprocess.check_output(['gcloud', 'storage', 'cat', f'gs://{bucket}/{obj}#{generation}'])
        if sha(archive) != row['archiveSha256']:
            raise RuntimeError('archive differs from audited hash: ' + name)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            if len(z.namelist()) != len(set(z.namelist())):
                raise RuntimeError('duplicate archive members: ' + name)
            reports[name] = {}
            for path in paths:
                f = root / path
                candidate = f.read_bytes() if f.is_file() else None
                reports[name][path] = compare(z, path, row['files'][path], candidate, output / name / (path + '.diff'))
    if any(audit.binding(name) != src for name, src in initial.items()):
        raise RuntimeError('live source changed during review; discard private review files')
    result = {'status': 'REVIEW_ONLY_NOT_DEPLOYABLE', 'productionWrites': 0,
              'privateReviewDir': str(output), 'functions': reports}
    (output / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
