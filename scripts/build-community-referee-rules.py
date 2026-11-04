"""Add general-room seat access to a pinned live Rules capture; never deploy."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_HASH = '580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e'
BASE = ROOT / 'referee-seats/reference/firestore.production-20261104.rules'
TARGET = ROOT / 'release/community-referee/firestore.rules'


def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Live Rules anchor changed: ' + old)
    return source.replace(old, new)


def group_terms(source, start):
    """Split a parenthesized policy disjunction without changing its terms."""
    depth, quote, comment, escaped, term_start = 1, None, False, False, start
    terms = []
    i = start
    while i < len(source):
        char = source[i]
        if comment:
            if char == '\n':
                comment = False
        elif quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
        elif source[i:i+2] == '//':
            comment = True
        elif char in ('"', "'"):
            quote = char
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                terms.append(source[term_start:i])
                return i, terms
        elif depth == 1 and source[i:i+2] == '||':
            terms.append(source[term_start:i])
            term_start = i + 2
            i += 1
        i += 1
    raise ValueError('Unbalanced management policy group')


def prioritize_owners(source):
    """Reorder existing OR terms only; never add or relax a predicate.

    The shared lottery, lifecycle, roster and CALL fences remain outside each
    group. Owner terms run before expensive unrelated role branches so valid
    owner JSON writes fit Firestore's expression budget with bucket guards.
    """
    edits = []
    for marker, predicate in [('callWriteValid() && (', 'isCommunityOwnerData(resource.data)'),
                              ('callMirrorValid(code) && (', 'isCommunityOwnerData(tournamentDataFor(code))')]:
        cursor, count = 0, 0
        while True:
            found = source.find(marker, cursor)
            if found < 0:
                break
            start = found + len(marker)
            end, terms = group_terms(source, start)
            owners = [i for i, term in enumerate(terms) if predicate in term]
            if len(owners) != 1:
                raise ValueError('Expected one unchanged owner term in management group')
            index = owners[0]
            before = source[start:end]
            after = '||'.join([terms[index], *terms[:index], *terms[index+1:]])
            edits.append((before, after))
            source = source[:start] + after + source[end:]
            cursor = start + len(after) + 1
            count += 1
        if count != 3:
            raise ValueError('Unexpected management policy branch count')
    return source, edits


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
    return prioritize_owners(source)[0]


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
