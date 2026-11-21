#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
pkg = root / 'release/buckets/derived'
tests = root / 'tests/four-court-buckets/derived'
m = json.loads((pkg / 'manifest.json').read_text())
items = {
    'deployedIndexSha256': tests / 'deployed-index.js',
    'candidateIndexSha256': pkg / 'candidate/index.js',
    'patchSha256': pkg / 'index.patch',
    'officialMatchHelperSha256': tests / 'official-match-titles-core.cjs',
}
for key, path in items.items():
    assert hashlib.sha256(path.read_bytes()).hexdigest() == m[key], key
assert m['deployed'] is False and m['productionWrites'] == 0
with tempfile.TemporaryDirectory() as directory:
    target = Path(directory) / 'deployed/index.js'
    target.parent.mkdir()
    target.write_bytes(items['deployedIndexSha256'].read_bytes())
    subprocess.run(['patch', '--batch', '-p0', '-d', directory, '-i', str(pkg / 'index.patch')], check=True, capture_output=True)
    assert target.read_bytes() == items['candidateIndexSha256'].read_bytes(), 'patch changed unexpected bytes'
print('PASS exact deployed index, single-file patch and candidate')
