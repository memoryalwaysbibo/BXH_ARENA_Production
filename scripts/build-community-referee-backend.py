"""Build two referee Callable candidates from their exact captured live source.

No cloud access or deployment. Preserve live exports, engine and lockfile.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'referee-seats/reference/community-referee.production-20261104.json'
MANIFEST = ROOT / 'release/community-referee/backend-manifest.json'
OVERLAYS = ('core.cjs', 'dispatch-core.cjs', 'scoring-service.cjs', 'service.cjs')
ADDITIONS = ('score-diagnostics.cjs',)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Source anchor changed: ' + old[:100])
    return source.replace(old, new)


def community_scoring(live, reviewed):
    # Only general-room authorization is added. In particular, do not introduce
    # bucket-local propagation, another scoring engine or projection changes.
    live = once(live, "const POINTS=", "const EventStaff=require('./event-staff-core.cjs');\nconst POINTS=")
    start = reviewed.index('function communitySupport(')
    end = reviewed.index('function allowed(', start)
    live = once(live, 'function allowed(', reviewed[start:end] + 'function allowed(')
    start, end = live.index('function allowed('), live.index('function passProtected(')
    reviewed_start, reviewed_end = reviewed.index('function allowed('), reviewed.index('function passProtected(')
    live = live[:start] + reviewed[reviewed_start:reviewed_end] + live[end:]
    old = " if(room.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||state.meta?.battleMode==='team'||state.meta?.playMode==='enchantment')fail('unsupported-mode');"
    new = next(line for line in reviewed.splitlines() if line.startswith(' if((room.eventAuthority!=='))
    live = once(live, old, new)
    return once(live, 'module.exports={transition,allowed,publicProjection};',
                'module.exports={communitySeatedPlayer,communitySupport,transition,allowed,publicProjection};')


def build():
    reference = json.loads(REFERENCE.read_text())
    archive = (REFERENCE.parent / reference['sourceFile']).read_bytes()
    if len(reference['functions']) != 2 or any(item['archiveSha256'] != sha(archive) for item in reference['functions']):
        raise ValueError('Live function source archive mismatch')
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        if set(source.namelist()) != set(reference['sourceFiles']):
            raise ValueError('Unexpected source archive entries')
        original = {name: source.read(name) for name in source.namelist()}
    for name, data in original.items():
        if name.startswith('/') or '..' in Path(name).parts or sha(data) != reference['sourceFiles'][name]:
            raise ValueError('Live source file mismatch: ' + name)
    files = dict(original)
    for name in (*OVERLAYS, *ADDITIONS):
        files[name] = (ROOT / 'referee-seats/functions' / name).read_bytes()
    files['scoring-core.cjs'] = community_scoring(original['scoring-core.cjs'].decode(),
                                               (ROOT / 'referee-seats/functions/scoring-core.cjs').read_text()).encode()
    changed = sorted(name for name in files if name not in original or files[name] != original[name])
    if set(changed) != set(OVERLAYS) | set(ADDITIONS) | {'scoring-core.cjs'}:
        raise ValueError('Unexpected release source scope')
    for name in ('index.js', 'package.json', 'package-lock.json', 'bucket-legacy-fence.cjs',
                 'event-staff-core.cjs', *[n for n in original if n.startswith('engine/')]):
        if files[name] != original[name]:
            raise ValueError('Protected live source changed: ' + name)
    manifest = {'project': reference['project'], 'capturedAt': reference['capturedAt'],
                'sourceArchiveSha256': sha(archive), 'rulesBaselineSha256': reference['rulesSha256'],
                'rulesCandidateSha256': sha((ROOT / 'release/community-referee/firestore.rules').read_bytes()),
                'functions': ['manageRefereeSeats', 'commitRefereeCommand'],
                'changedFiles': changed,
                'preservedLiveIndexAndEngine': True, 'productionWrites': 0,
                'files': {name: {'baselineSha256': sha(original[name]) if name in original else None, 'candidateSha256': sha(files[name])}
                          for name in sorted(files)}}
    return files, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Empty local staging directory; never a cloud target')
    parser.add_argument('--check', action='store_true', help='Require the committed manifest to reproduce exactly')
    args = parser.parse_args()
    files, manifest = build()
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if MANIFEST.read_text() != text:
            raise SystemExit('Release source manifest differs from reviewed candidate')
    else:
        MANIFEST.write_text(text)
    if args.output:
        if args.output.exists() and any(args.output.iterdir()):
            raise SystemExit('Staging directory must be empty')
        args.output.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            target = args.output / 'functions' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (args.output / 'backend-manifest.json').write_text(text)
        (args.output / 'firebase.json').write_text(json.dumps({'functions': [{'source': 'functions', 'codebase': 'referee-seats'}]}, indent=2) + '\n')
    print('PASS: exact captured source plus reviewed overlays and diagnostic helper; original engine/index/lockfile preserved; no deployment')


if __name__ == '__main__':
    main()

