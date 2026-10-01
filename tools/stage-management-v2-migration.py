#!/usr/bin/env python3
"""Stage V2 M1 in a NEW directory. Never edit the source or deploy anything."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import shutil

BASE_COMMIT = 'fdd1c73c7e61e97deb0c15c325057b6301bbec37'
INDEX_BLOB = 'ff61e00a1ed2ca15eff7af9a8de83aeff9141b92'
MOVES = {
    'management-ui-v2.js': 'modules/management-v2/navigation.js',
    'management-ui-v2-adapter.js': 'modules/management-v2/adapter.js',
    'management-ui-v2-bootstrap.js': 'modules/management-v2/bootstrap.js',
    'management-ui-v2.css': 'modules/management-v2/styles.css',
}
BLOBS = {
    'management-ui-v2.css': '23c7cfeec1aadb8e66e02d2c560ab8e710210cd3',
    'management-ui-v2.js': 'd5cd1cb5da359d58fc501f9c779852a151b539e4',
    'management-ui-v2-adapter.js': '4d9b750daa799b20c67e9f1f0a474408c05e591a',
    'management-ui-v2-bootstrap.js': '7946f4cc0aa7d26753a47f3fd683ff42324ff04d',
}


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def stage(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents or output in source.parents:
        raise ValueError('Output must be outside the source tree.')
    if output.exists():
        raise ValueError('Output already exists; refusing to overwrite.')
    originals = {p: (source / p).read_bytes() for p in ['index.html', *MOVES]}
    if blob(originals['index.html']) != INDEX_BLOB:
        raise ValueError('index.html baseline changed: re-review before migration.')
    for p, expected in BLOBS.items():
        if blob(originals[p]) != expected:
            raise ValueError('V2 baseline changed: ' + p)
    texts = {}
    patches = []
    for p, expected_count in [('index.html', 4), ('management-ui-v2-preview.html', 2),
                              ('tests/management-ui-v2-smoke.html', 1)]:
        raw = (source / p).read_bytes()
        before = raw.decode('utf-8')
        after, count = before, 0
        for old, new in MOVES.items():
            for attr in ('src', 'href'):
                for prefix in ('', '../'):
                    needle = attr + '="' + prefix + old
                    count += after.count(needle)
                    after = after.replace(needle, attr + '="' + prefix + new)
        if count != expected_count:
            raise ValueError('Unexpected reference count in ' + p + ': ' + str(count))
        if p.startswith('tests/'):
            # Keep five usable groups AND the existing disabled Hunter placeholder.
            old = 'M.visibleGroups(admin).length===5'
            if after.count(old) != 1:
                raise ValueError('Smoke baseline changed.')
            after = after.replace(old, 'M.visibleGroups(admin).filter(g=>!g.placeholder).length===5')
            after = after.replace('querySelectorAll("[data-management-v2-group]").length===5',
                                  'querySelectorAll("[data-management-v2-group]:not(.is-placeholder)").length===5')
        texts[p] = after.encode('utf-8')
        patches.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                           fromfile='a/' + p, tofile='b/' + p))
    # Check first, then create a fresh staging tree. Root compatibility URLs stay intact.
    for old, new in MOVES.items():
        path = source / new
        if path.exists() and path.read_bytes() != originals[old]:
            raise ValueError('Conflicting staged module: ' + new)
    shutil.copytree(source, output, ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))
    for old, new in MOVES.items():
        target = output / new
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(originals[old])
    for p, data in texts.items():
        (output / p).write_bytes(data)
    manifest = {
        'status': 'STAGED_ONLY_NOT_DEPLOYED', 'base_commit': BASE_COMMIT,
        'source_index_blob': INDEX_BLOB, 'entrypoint_path_replacements': 4,
        'source_index_bytes': len(originals['index.html']),
        'candidate_index_bytes': len(texts['index.html']),
        'legacy_urls_retained': True,
        'modules': [{'from': old, 'to': new, 'sha256': hashlib.sha256(originals[old]).hexdigest()}
                    for old, new in MOVES.items()],
    }
    (output / 'management-v2-migration-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'management-v2-m1.patch').write_text(''.join(patches), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(stage(args.source, args.output), ensure_ascii=False, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, 'STAGING BLOCKED: ' + str(error) + '\n')
