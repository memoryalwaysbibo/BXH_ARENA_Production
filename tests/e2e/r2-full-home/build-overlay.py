#!/usr/bin/env python3
"""Create three pinned synthetic test fixture files only. Never read runtime captures."""
import hashlib
import json
import pathlib
import subprocess
import sys

BASE = "cbfeb2904d3628e49bfb7527fd1f7f7ab63e1be2"
HERE = pathlib.Path(__file__).resolve().parent
FILES = {
    "index.html": ("7c7dc38133eb0bb5e4c8656e0e0162a10e4d4ea6", "a8e29e1bb7772d1923188e0db26406611320203b59b3d6b88d2cf9d8a49f19ec", 2),
    "modules/main-app/core.js": ("e31ffe5d632663d61d3f4ffd7083c860854addea", "aa27e8c923e6312f49b2c35bfd9c08db37d04aa631d78f4491d3157ee99219fe", 25),
}
CONTROLLER = "1add3462dc19409e3c2763f282cd31f555459e4e2768fda67ef20f1fe04697e6"
GATES = {
    "firebase.json": "577e38dd55e8cf3e8efba1f74b5c3b657831bfb2c8661f588b41c414fc55e0ab",
    "firestore.rules": "ae900128d0fd2d43bc4109e299d756d4f51cebf300732f691961696e9527f27a",
}

def sha(b):
    return hashlib.sha256(b).hexdigest()

def git_blob(b):
    return hashlib.sha1(f"blob {len(b)}\0".encode() + b).hexdigest()

def build(repo, out):
    if out.exists():
        raise SystemExit("Fixture output must not already exist")
    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args])
    if git("rev-parse", "HEAD").decode().strip() != BASE:
        raise SystemExit("Exact fixture base unavailable")
    for name, digest in GATES.items():
        if sha((HERE/name).read_bytes()) != digest:
            raise SystemExit("Demo-only rules/config differs from reviewed fixture: " + name)
    changes = json.loads((HERE/"r2-anchors.json").read_text())
    if set(changes) != set(FILES):
        raise SystemExit("Unexpected fixture source files")
    outputs = {}
    for name, (blob, digest, count) in FILES.items():
        source = git("show", BASE + ":" + name)
        edits = changes[name]
        if git_blob(source) != blob or len(edits) != count:
            raise SystemExit("Unexpected exact source or anchor count: " + name)
        text = source.decode()
        for old, new in edits:
            if not old or text.count(old) != 1:
                raise SystemExit("Expected exactly one fixture anchor match: " + name)
            text = text.replace(old, new, 1)
        result = text.encode()
        if sha(result) != digest:
            raise SystemExit("Fixture output hash mismatch: " + name)
        outputs[name] = result
    controller = (HERE/"home-summary-lab.js").read_bytes()
    if sha(controller) != CONTROLLER:
        raise SystemExit("Fixture controller hash mismatch")
    outputs["modules/main-app/home-summary-lab.js"] = controller
    for name, data in outputs.items():
        target = out/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print("R2 verified exact base, all 27 anchors, three output SHA-256 hashes and demo rule/config bytes")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("build-overlay.py EXACT_BASE_REPO NEW_TEMP_OUTPUT")
    build(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
