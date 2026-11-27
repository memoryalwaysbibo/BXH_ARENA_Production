"""Build offline, function-specific bucket sources from the exact uploaded live capture. Never deploy."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_SHA = '6cc3622e824b63aa6357a3ee9a10431aa8a39a5022a813d42b29a6334c63e1b9'
RULES_SHA = '004f5e93fada69dfd14c9b614d8b14fb69901b3d593491f227f8ddb189313377'
GENS = {'commitBucketRefereeCommand': '1795789649341559', 'manageBucketRefereeSeats': '1795789577496578', 'projectBucketPublicScore': '1795789721560852'}
COPY = ('bucket-state.cjs', 'bucket-runtime.cjs', 'bucket-scoring-service.cjs', 'bucket-public-projection.cjs',
        'bucket-projection-trigger.cjs', 'bucket-migration-plan.cjs', 'bucket-migration-service.cjs',
        'bucket-migration-operator.cjs', 'bucket-general-archive.cjs', 'score-diagnostics.cjs',
        'engine/index.cjs', 'engine/pass-return.cjs')
PROTECTED = ('index.js', 'package.json', 'package-lock.json', 'core.cjs', 'event-staff-core.cjs',
             'service.cjs', 'scoring-service.cjs', 'bucket-callable.cjs', 'bucket-runtime-entry.cjs',
             'bucket-seat-service.cjs', 'bucket-legacy-fence.cjs')


def sha(data): return hashlib.sha256(data).hexdigest()

def once(text, old, new):
    if text.count(old) != 1: raise ValueError('Reviewed source anchor changed')
    return text.replace(old, new, 1)


def overlay_scoring(live, candidate):
    # The current live baseline already has PASS and round guards. Add only
    # the two reviewed manual-return fields, without replacing authorization.
    old = "requestedStation:m.passReturn.requestedStation||null,waitFor:"
    new = "requestedStation:m.passReturn.requestedStation||null,manualRequestedAt:m.passReturn.manualRequestedAt||null,manualWaitFor:m.passReturn.manualWaitFor||[],waitFor:"
    if candidate.count(new) != 1: raise ValueError('Candidate projection anchor changed')
    return once(live, old, new)


def overlay_dispatch(live):
    old = "PassReturn.readiness(state,m).ok))fail('pass-protected');"
    new = "PassReturn.readiness(state,m,{manual:true}).ok))fail('pass-protected');"
    # The score function already has the reviewed manual PASS dispatch guard.
    if live.count(new) == 1 and live.count(old) == 0: return live
    return once(live, old, new)


def overlay_rules(live):
    if sha(live.encode()) != RULES_SHA: raise ValueError('Unreviewed live Rules')
    old = "        && storage.get('schema', '') == 'bxh-match-buckets-v1'"
    return once(live, old, "        && (storage.get('schema', '') == 'bxh-match-buckets-v1'\n          || (storage.get('schema', '') == 'bxh-court-buckets-v2' && config.get('perCourtStorageEnabled', false) == true))")


def build(bundle):
    if sha(Path(bundle).read_bytes()) != BUNDLE_SHA: raise ValueError('Source capture hash mismatch')
    with zipfile.ZipFile(bundle) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or any(n.startswith('/') or '..' in n.split('/') or '\\' in n for n in names): raise ValueError('Unsafe source capture')
        captured = json.loads(z.read('manifest.json'))
        if captured['project'] != 'bxh-arena' or captured['productionWrites'] != 0 or set(captured['functions']) != set(GENS): raise ValueError('Unexpected capture scope')
        result = {}; report = {'project': 'bxh-arena', 'productionWrites': 0, 'deployableWithoutFreshReview': False, 'captureSha256': BUNDLE_SHA, 'functions': {}}
        for function, generation in GENS.items():
            info = captured['functions'][function]
            if str(info['source']['generation']) != generation: raise ValueError('Unexpected source generation')
            original = {p: z.read(function + '/' + p) for p in info['selectedFiles']}
            if any(sha(data) != info['selectedFiles'][p] for p, data in original.items()): raise ValueError('Selected source fingerprint mismatch')
            files = dict(original)
            for name in COPY: files[name] = (ROOT / 'referee-seats/functions' / name).read_bytes()
            files['scoring-core.cjs'] = overlay_scoring(original['scoring-core.cjs'].decode(), (ROOT / 'referee-seats/functions/scoring-core.cjs').read_text()).encode()
            files['dispatch-core.cjs'] = overlay_dispatch(original['dispatch-core.cjs'].decode()).encode()
            for name in PROTECTED:
                if files.get(name) != original.get(name): raise ValueError('Protected source changed: ' + name)
            for name in ('engine/court-retirement.cjs', 'engine/double-elimination.cjs', 'engine/fault.cjs', 'engine/match-utils.cjs'):
                if original[name] != (ROOT / 'referee-seats/functions' / name).read_bytes(): raise ValueError('Engine dependency differs: ' + name)
            changed = sorted(p for p in files if files[p] != original.get(p))
            if not set(changed) <= set(COPY) | {'scoring-core.cjs', 'dispatch-core.cjs'}: raise ValueError('Unexpected overlay scope')
            result[function] = files
            report['functions'][function] = {'generation': generation, 'revision': info['revision'], 'changedFiles': changed,
                'files': {p: {'before': sha(original[p]) if p in original else None, 'after': sha(data)} for p, data in sorted(files.items())}, 'protectedFilesUnchanged': True}
        live = z.read('firestore.live.rules').decode(); rules = overlay_rules(live)
        report['rules'] = {'before': sha(live.encode()), 'after': sha(rules.encode()), 'onlyChange': 'Opt-in v2 schema in scoreBucketReadable; every other byte preserved'}
        report['rooms'] = captured['rooms']; report['release'] = captured['release']
        return result, rules, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists(): raise SystemExit('Refusing to overwrite a staging directory')
    files, rules, report = build(args.bundle)
    args.output.mkdir(parents=True)
    for function, members in files.items():
        for name, data in members.items():
            target = args.output / function / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
    (args.output / 'firestore.rules').write_text(rules)
    (args.output / 'release-plan.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'staged': str(args.output), 'productionWrites': 0, 'rulesSha256': report['rules']['after'], 'functions': {k: v['changedFiles'] for k, v in report['functions'].items()}}, indent=2))
