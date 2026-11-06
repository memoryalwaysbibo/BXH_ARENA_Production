#!/usr/bin/env python3
"""Compose the closed bucket deletion lease guards onto reviewed community Rules.

This is an offline candidate builder. It cannot deploy or access production.
"""

import argparse
from difflib import SequenceMatcher
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'tests/four-court-buckets/deletion/fixtures/baseline.rules'
BUCKET = ROOT / 'release/buckets/firestore.rules'
COMMUNITY = ROOT / 'release/community-referee/firestore.rules'
OUTPUT = ROOT / 'release/buckets/community-reconciled.rules'
EXPECTED = {
    BASE: '580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e',
    BUCKET: '3b225ddc8121ffdce95062c4ea230f24882887e7768cd445f876e4484d212101',
    COMMUNITY: 'dbdb8dc9ba46a110d6f8786cdc7ee4b9badc6bd3120769f4393bf51f31cbc9c3',
}
COMPOSED_SHA = '1506738795a145ff11f980c7afc5d8819e2d5f909e73fd2664d2bba11717fe0c'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compose():
    raw = {path: path.read_bytes() for path in EXPECTED}
    for path, expected in EXPECTED.items():
        if digest(raw[path]) != expected:
            raise ValueError('Pinned source changed: ' + str(path.relative_to(ROOT)))
    base, bucket, community = (
        raw[path].decode('utf-8').splitlines(keepends=True)
        for path in (BASE, BUCKET, COMMUNITY)
    )
    edits = []
    for tag, before_start, before_end, after_start, after_end in SequenceMatcher(
        None, base, bucket, autojunk=False
    ).get_opcodes():
        if tag == 'equal':
            continue
        if tag != 'replace' or before_end - before_start != 1 or after_end - after_start != 1:
            raise ValueError('Bucket Rules include an unexpected edit shape')
        edits.append((base[before_start], bucket[after_start]))
    if len(edits) != 5:
        raise ValueError('Expected exactly five deletion lease guard edits')
    for before, after in edits:
        if community.count(before) != 1:
            raise ValueError('Community Rules anchor changed or is ambiguous')
        community[community.index(before)] = after
    result = ''.join(community).encode('utf-8')
    # The public mirror update is close to the Firestore expression ceiling.
    # One map-keys check preserves both current private-root markers. The
    # existing scoreStorage getAfter remains. Client Rules forbid introducing
    # bucketMigration on the private root in the same batch (and on create).
    before = ("!('bucketMigration' in resource.data) && !('bucketMigration' in tournamentDataFor(code)) && "
              "!('bucketMigration' in tournamentDataAfterFor(code)) && "
              "!('scoreStorage' in tournamentDataFor(code)) && !('scoreStorage' in tournamentDataAfterFor(code))")
    after = ("!('bucketMigration' in resource.data) && "
             "!tournamentDataFor(code).keys().hasAny(['bucketMigration','scoreStorage']) && "
             "!('scoreStorage' in tournamentDataAfterFor(code))")
    if result.count(before.encode()) != 1:
        raise ValueError('Public mirror marker anchor changed')
    result = result.replace(before.encode(), after.encode(), 1)
    if digest(result) != COMPOSED_SHA:
        raise ValueError('Composed Rules differ from reviewed merge result')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = compose()
    if args.check:
        if OUTPUT.read_bytes() != result:
            raise SystemExit('Composed Rules file differs')
    else:
        OUTPUT.write_bytes(result)
    print('PASS: five deletion lease guards composed on community Rules; no deployment')


if __name__ == '__main__':
    main()
