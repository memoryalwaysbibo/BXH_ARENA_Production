"""Add general-room seat access to a pinned live Rules capture; never deploy."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_HASH = 'cc92f06579800bd9dcbd7fca3af36fcbd4a80989f795164ec847b0211fe694a9'
BASE = ROOT / 'referee-seats/reference/firestore.production-20261102.rules'
TARGET = ROOT / 'release/community-referee/firestore.rules'


def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Live Rules anchor changed: ' + old)
    return source.replace(old, new)


def build(source, reviewed):
    if hashlib.sha256(source.encode()).hexdigest() != BASE_HASH:
        raise ValueError('Live Rules differ from reviewed capture; reconcile before deployment')
    start = reviewed.index('    // General-room referees receive private read access')
    end = reviewed.index('    // Read-only bucket access follows', start)
    helper = reviewed[start:end]
    source = once(source, '    // Seat ownership / request changes',
                  helper + '    // Seat ownership / request changes')
    # Preserve every current management predicate; add only the existing owner
    # predicate to the two seat-enabled JSON management branches.
    start = source.index('    function refereeSeatWriteValid(')
    end = source.index('    // ==== 路徑輔助函式', start)
    guard = source[start:end]
    owner = '|| isAdminOrAbove() || isStaffOfficialCreatorExistingData(room)'
    if guard.count(owner) != 2:
        raise ValueError('Seat management guard changed')
    source = source[:start] + guard.replace(owner, '|| isCommunityOwnerData(room) ' + owner) + source[end:]
    source = once(source,
                  'allow get: if isSignedIn() && (canReadTournamentPrivate(resource.data)',
                  'allow get: if isSignedIn() && (communityRefereeReadable(resource.data) || canReadTournamentPrivate(resource.data)')
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=BASE)
    parser.add_argument('--output', type=Path, default=TARGET)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build(args.source.read_text(), (ROOT / 'referee-seats/firestore.candidate.rules').read_text())
    if args.check:
        if args.output.read_text() != result:
            raise SystemExit('General-room release Rules differ from reviewed composition')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print('PASS: captured live Rules preserved with general-room seat access; no deployment')
