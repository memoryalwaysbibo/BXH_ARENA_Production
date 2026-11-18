"""Build offline, function-specific bucket sources from the exact uploaded live capture. Never deploy."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_SHA = 'aefe79320490411e4fc8b2f4b91c5a2fb8f710b98ecb59d52a727a31731d5eac'
RULES_SHA = '23f7acd2e06c428f3a628d1dad02d703b746cd28d1f48e6caf8c606248982e68'
GENS = {'commitBucketRefereeCommand': '1794722128839589', 'manageBucketRefereeSeats': '1794722195891401', 'projectBucketPublicScore': '1794722273213484'}
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
    # Retain deployed official-only authorization and all existing exports.
    text = once(live, 'const POINTS=', "const PassReturn=require('./engine/pass-return.cjs').BXHPassReturn;\nconst POINTS=")
    old = " if(m.callPass?.waitFor?.some(id=>!state.matches.find(x=>x.id===id)?.completed))fail('pass-protected');"
    text = once(text, old, old + "\n if(m.skippedAt&&PassReturn.supported(state))fail(PassReturn.readiness(state,m).ok?'pass-awaiting-dispatch':'pass-protected');")
    old = "  if(engine.singleElimBronzeBeforeFinalBlocked(m,state.matches,state.meta))fail('bronze-before-final');"
    text = once(text, old, old + "\n  if(['start','ready'].includes(action)&&engine.singleElimRoundDispatchBlocked(m,state.matches,state.meta))fail('previous-round-waiting');")
    old = next(line for line in live.splitlines() if line.startswith(' mirror.matches='))
    new = next(line for line in candidate.splitlines() if line.startswith(' mirror.matches='))
    return once(text, old, new)


def overlay_dispatch(live):
    old = "const ACTIONS=new Set("
    text = once(live, old, "const PassReturn=require('./engine/pass-return.cjs').BXHPassReturn;\n" + old)
    return once(text, "  if(protectedPass(state,m))fail('pass-protected');", "  if(protectedPass(state,m)&&!(action==='claim-skipped'&&PassReturn.supported(state)&&PassReturn.readiness(state,m).ok))fail('pass-protected');")


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
