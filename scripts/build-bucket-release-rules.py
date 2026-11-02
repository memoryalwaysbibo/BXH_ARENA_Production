"""Add only reviewed bucket guards to the captured live Rules; never deploy."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_HASH = 'cc92f06579800bd9dcbd7fca3af36fcbd4a80989f795164ec847b0211fe694a9'


def build(source, reviewed):
    if hashlib.sha256(source.encode()).hexdigest() != BASE_HASH:
        raise ValueError('Unreviewed live baseline; capture and reconcile it first')
    if 'function scoreBucketReadable(' in source:
        raise ValueError('Baseline already contains bucket helper')
    start = reviewed.index('    // Read-only bucket access follows')
    end = reviewed.index('    // Seat ownership / request changes', start)
    helper = reviewed[start:end]
    start = reviewed.index('      match /matchBuckets/{id}')
    end = reviewed.index('      match /refereeSeatAudit/{id}', start)
    subcollections = reviewed[start:end]
    edits = [
        ('    // Seat ownership / request changes', helper + '    // Seat ownership / request changes'),
        ("return !changed.hasAny(['refereeSeatsV1','refereeSeatNames'])", "return !changed.hasAny(['refereeSeatsV1','refereeSeatNames','bucketMigration'])"),
        ("function noOperationsCreate(d) { return !d.keys().hasAny(['refereeSeatsV1','refereeSeatNames',", "function noOperationsCreate(d) { return !d.keys().hasAny(['refereeSeatsV1','refereeSeatNames','bucketMigration',"),
        ('      match /refereeSeatAudit/{id}', subcollections + '      match /refereeSeatAudit/{id}'),
        ("['registrationSelection','registeredCount','eventStaffAssignments']) && noOperationsCreate", "['registrationSelection','registeredCount','eventStaffAssignments','scoreStorage']) && noOperationsCreate"),
        ("allow update: if refereeSeatWriteValid(code, true)", "allow update: if !('scoreStorage' in resource.data) && !('scoreStorage' in request.resource.data) && refereeSeatWriteValid(code, true)"),
        ("allow update: if refereeSeatWriteValid(code, false)", "allow update: if tournamentExistsFor(code) && tournamentExistsAfterFor(code) && !('scoreStorage' in tournamentDataFor(code)) && !('scoreStorage' in tournamentDataAfterFor(code)) && refereeSeatWriteValid(code, false)"),
        ("&& noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && (", "&& noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && !('scoreStorage' in tournamentDataAfterFor(code)) && ("),
    ]
    for old, new in edits:
        if source.count(old) != 1:
            raise ValueError('Baseline anchor changed: ' + old)
        source = source.replace(old, new)
    private, anchor, public = source.partition('    match /publicTournaments/{code} {')
    old = "allow delete: if resource.data.get('qrCheckinManaged', false) != true"
    if private.count(old) != 1 or public.count(old) != 1 or not anchor:
        raise ValueError('Delete guard anchors changed')
    private = private.replace(old, "allow delete: if !('scoreStorage' in resource.data) && resource.data.get('qrCheckinManaged', false) != true")
    public = public.replace(old, "allow delete: if (!exists(tourPath(code)) || !('scoreStorage' in get(tourPath(code)).data)) && resource.data.get('qrCheckinManaged', false) != true")
    return private + anchor + public


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build((ROOT / 'referee-seats/reference/firestore.production-20261102.rules').read_text(),
                   (ROOT / 'referee-seats/firestore.candidate.rules').read_text())
    target = ROOT / 'release/buckets/firestore.rules'
    if args.check:
        if target.read_text() != result:
            raise SystemExit('Release Rules differ from the reviewed composition')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(result)
    print('PASS: live baseline preserved with bucket-only guards; no deployment')
