#!/usr/bin/env python3
"""Assemble the closed registration V2 backend source bundle without deploying."""

import argparse
import hashlib
import json
import re
import runpy
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = "https://raw.githubusercontent.com/memoryalwaysbibo/BXH_ARENA_Production"
ARCHIVE_HASHES = {
    "familyRegistration": "db015fb8fa78db14fab41e1f5cc18d8aa9ac8e3a9bcadcf17b425171db64a55d",
    "registrationRosterService": "9f243a0b73e183bae97d80da345b11e81b1b54edc961b51d57408ea6c6e6d515",
}
APPLICATION_FILES = (
    "registration-flow-v2/backend/api.cjs",
    "registration-flow-v2/backend/bindings.cjs",
    "registration-flow-v2/backend/legacy-writer.cjs",
    "registration-flow-v2/backend/lifecycle.cjs",
    "registration-flow-v2/backend/management.cjs",
    "registration-flow-v2/backend/prepare-family.cjs",
    "registration-flow-v2/backend/prepare-roster.cjs",
    "registration-flow-v2/backend/queue.cjs",
    "registration-flow-v2/release-inputs.json",
    "registration-promotion/functions/service.cjs",
    "modules/main-app/bracket-commit.js",
    "qr-checkin/backend/qr-checkin-fence.cjs",
    "qr-checkin/backend/overlays/lifecycle/operations-core.js",
    "referee-seats/functions/engine/index.cjs",
    "referee-seats/functions/engine/court-retirement.cjs",
    "referee-seats/functions/engine/double-elimination.cjs",
    "referee-seats/functions/engine/match-utils.cjs",
)
ENTRYPOINTS = (
    "registrationQueueV2", "registrationRosterQueueV2", "registrationQueueV2Worker",
    "registrationQueueV2Sweep", "registrationDrawV2", "registrationStartV2",
)
PACKAGE = {
    "name": "bxh-registration-v2-closed", "private": True, "main": "index.cjs",
    "engines": {"node": "22"},
    "dependencies": {"firebase-admin": "14.4.0", "firebase-functions": "7.3.2"},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2) + "\n").encode()


def download(ref, path):
    with urllib.request.urlopen(f"{REPOSITORY}/{ref}/{path}", timeout=20) as response:
        return response.read()


def read_writer(reader, name, baseline, archive):
    original = reader["describe"](name)
    revision, bucket, obj, generation = original
    if revision != baseline["revision"] or generation != baseline["generation"]:
        raise ValueError(f"{name}: deployment revision or generation changed")
    reader["gcloud"]("storage", "cp", f"gs://{bucket}/{obj}#{generation}", str(archive))
    with archive.open("rb") as stream:
        archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    if archive_sha != ARCHIVE_HASHES[name]:
        raise ValueError(f"{name}: source archive changed")
    hashes = reader["source_hashes"](archive, baseline["files"])
    for path, expected in baseline["files"].items():
        if hashes.get(path) != expected:
            raise ValueError(f"{name}: reviewed source mismatch: {path}")
    with zipfile.ZipFile(archive) as source:
        files = {path: source.read(path) for path in baseline["files"]}
    if reader["describe"](name) != original:
        raise ValueError(f"{name}: source changed during assembly")
    return files


def collect(ref, get_file, read_inputs):
    files = {name: get_file(name) for name in APPLICATION_FILES}
    manifest = json.loads(files["registration-flow-v2/release-inputs.json"])
    if set(manifest) != set(ARCHIVE_HASHES):
        raise ValueError("unexpected source manifest")
    files["index.cjs"] = get_file("registration-flow-v2/closed-entrypoint.cjs")
    files["package.json"] = json_bytes(PACKAGE)
    with tempfile.TemporaryDirectory(prefix="bxh746-closed-", dir="/tmp") as temp:
        work = Path(temp)
        for name, baseline in manifest.items():
            inputs = read_inputs(name, baseline, work / f"{name}.zip")
            for filename, expected in baseline["files"].items():
                if filename not in inputs or digest(inputs[filename]) != expected:
                    raise ValueError(f"{name}: input digest mismatch: {filename}")
            if name == "familyRegistration":
                source = work / "family-registration.js"
                source.write_bytes(inputs["family-registration.js"])
                transformer = work / "prepare-family.cjs"
                transformer.write_bytes(files["registration-flow-v2/backend/prepare-family.cjs"])
                inputs["family-registration.js"] = subprocess.run(
                    ["node", str(transformer), str(source)], check=True, capture_output=True, timeout=15,
                ).stdout
            for path in baseline["files"]:
                files[f"writer-inputs/{name}/{path}"] = inputs[path]
    return files, {
        "candidateCommit": ref,
        "entrypoints": ENTRYPOINTS,
        "activation": "HARD_CLOSED",
        "productionWrites": 0,
        "sourceArchiveSha256": ARCHIVE_HASHES,
        "files": {path: digest(data) for path, data in sorted(files.items())},
    }


def write_bundle(output, files, receipt, indexes):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    archive = output / "function-source.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for path, data in sorted(files.items()):
            info = zipfile.ZipInfo(path)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    (output / "firestore-indexes.candidate.json").write_bytes(indexes)
    receipt.update(
        bundleSha256=digest(archive.read_bytes()),
        candidateIndexesSha256=digest(indexes),
    )
    (output / "manifest.json").write_bytes(json_bytes(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True, help="Full reviewed Git commit SHA")
    parser.add_argument("--output", required=True, type=Path, help="New local output directory")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.ref):
        parser.error("Use a full Git SHA.")
    if args.output.exists():
        parser.error("Use a new local output directory.")
    try:
        with tempfile.TemporaryDirectory(prefix="bxh746-reader-", dir="/tmp") as temp:
            helper = Path(temp) / "read-live-writers.py"
            helper.write_bytes(download(args.ref, "registration-flow-v2/tools/read-live-writers.py"))
            reader = runpy.run_path(str(helper))
            files, receipt = collect(
                args.ref, lambda path: download(args.ref, path),
                lambda name, baseline, archive: read_writer(reader, name, baseline, archive),
            )
            indexes = download(args.ref, "registration-flow-v2/indexes.json")
        write_bundle(args.output, files, receipt, indexes)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "ASSEMBLY_STOPPED", "reason": str(error) if type(error) is ValueError else type(error).__name__,
                          "productionWrites": 0}))
        return 1
    print(json.dumps({"status": "CLOSED_BACKEND_STAGED", "output": str(args.output),
                      "entrypoints": ENTRYPOINTS, "bundleSha256": receipt["bundleSha256"],
                      "productionWrites": 0}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
