#!/usr/bin/env bash
# Read-only PTN source review. No checkout of entire repositories, no deployment.
set -euo pipefail
umask 077
export GIT_TERMINAL_PROMPT=0
WORK=$(mktemp -d /tmp/bxh-expansion-review.XXXXXX)
echo "Review workspace: $WORK"
df -h "$HOME" "$WORK"
cd "$WORK"

FRONT_BASE=41ab81f1bc57483c4529c6bdfb31842a5450fb5f
FRONT_HEAD=fd75f38f5b5ec0e7114e7bbc530b44092252eeef
BACK_BASE=8e4886cf08edfe40b5d677d96c2b06417da2fdb9
BACK_HEAD=1f6573b4aef69366120b3fed811d2702d226e80b
SETTLEMENT_HEAD=afde2fc515c0df5f06fd7724726e4433365ab696
TOOL_HEAD=${1:?Pass the reviewed tool commit SHA}

init_repo() {
  local root=$1 url=$2
  git init -q "$root"
  git -C "$root" remote add origin "$url"
  git -C "$root" config remote.origin.promisor true
  git -C "$root" config remote.origin.partialclonefilter blob:none
  git -C "$root" config gc.auto 0
}
fetch_ref() {
  local root=$1 ref=$2
  git -C "$root" -c protocol.version=2 fetch --depth=1 --no-tags --filter=blob:none origin "$ref"
  test "$(git -C "$root" rev-parse "$ref^{commit}")" = "$ref"
}
init_repo front https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git
init_repo backend https://github.com/memoryalwaysbibo/BXH_ARENA_Functions_Production.git
for ref in "$FRONT_BASE" "$FRONT_HEAD" "$TOOL_HEAD"; do fetch_ref front "$ref"; done
for ref in "$BACK_BASE" "$BACK_HEAD" "$SETTLEMENT_HEAD"; do fetch_ref backend "$ref"; done

for script in PTN_expansion_source_audit.py PTN_expansion_threeway_review.py; do
  git -C front show "$TOOL_HEAD:operator/$script" > "$script"
done
python3 PTN_expansion_threeway_review.py --self-test
# Materialize only the exact candidate files the original audit reads.
python3 - <<'PY'
from pathlib import Path
import PTN_expansion_source_audit as audit
import PTN_expansion_threeway_review as review
for root, ref, paths, prefix in (
    (Path('front'), review.FRONT_HEAD, audit.ROOM_FILES, ''),
    (Path('backend'), review.BACK_HEAD, audit.COMMERCE_FILES, 'release/commerce/functions/'),
):
    for path in paths:
        relative = prefix + path
        data = review.blob(root, ref, relative)
        if data is not None:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
PY

echo "=== SOURCE AUDIT (READ ONLY) ==="
python3 PTN_expansion_source_audit.py --front-root "$WORK/front" --backend-root "$WORK/backend" > audit.tmp
python3 -m json.tool audit.tmp > /dev/null
mv audit.tmp audit.json
echo "=== THREEWAY REVIEW (NOT DEPLOYABLE) ==="
python3 PTN_expansion_threeway_review.py --audit "$WORK/audit.json" --front-root "$WORK/front" --backend-root "$WORK/backend" > threeway.tmp
python3 -m json.tool threeway.tmp > /dev/null
mv threeway.tmp threeway.json
echo "=== ALL COMPLETE ==="
echo "Report: $WORK/threeway.json"
cat threeway.json
