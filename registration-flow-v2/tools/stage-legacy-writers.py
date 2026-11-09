#!/usr/bin/env python3
"""Stage remaining V2 fences on top of immutable production source ZIPs."""

import argparse
import hashlib
import json
import os
import runpy
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "familyRegistration": ("familyregistration-00041-ded", "1793854788506302", "family-registration.js"),
    "registrationRosterService": ("registrationrosterservice-00010-gaw", "1794225754757557", "roster-service.js"),
    "promoteSeatedRegistration": ("promoteseatedregistration-00003-fud", "1793639431385791", "service.cjs"),
    "manageOnsiteWaitlist": ("manageonsitewaitlist-00005-nog", "1793639856049774", "onsite-waitlist/firestore-store.js"),
    "manageRegistrationSelection": ("manageregistrationselection-00005-yik", "1794165925233744", "registration-selection.js"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def archive_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot(info):
    return digest(json.dumps(info, sort_keys=True, separators=(",", ":")).encode())


def stage_archive(name, member, original, candidate, scratch):
    with zipfile.ZipFile(original) as source:
        entries = source.infolist()
        names = {entry.filename for entry in entries}
        if len(entries) != len(names) or sum(entry.file_size for entry in entries) > 128 * 1024 * 1024:
            raise ValueError("invalid-archive-inventory")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError("unsafe-archive-entry")
        package_bytes = source.read("package.json")
        package = json.loads(package_bytes)
        main = PurePosixPath(package.get("main", "index.js"))
        if main.is_absolute() or ".." in main.parts or str(main) not in names:
            raise ValueError("entry-file-missing")
        if str(main) == member:
            raise ValueError("handler-overlaps-entry-file")
        handler = scratch / member
        handler.parent.mkdir(parents=True, exist_ok=True)
        old_bytes = source.read(member)
        handler.write_bytes(old_bytes)
        new_bytes = subprocess.check_output([
            "node", str(ROOT / "backend/prepare-legacy-writers.cjs"), name, str(handler)
        ], timeout=30)
        if not new_bytes or new_bytes == old_bytes:
            raise ValueError("handler-not-changed")
        handler.write_bytes(new_bytes)
        (scratch / "package.json").write_bytes(package_bytes)
        main_path = scratch / main
        main_path.parent.mkdir(parents=True, exist_ok=True)
        main_bytes = source.read(str(main))
        main_path.write_bytes(main_bytes)
        for path in (handler, main_path):
            subprocess.run(["node", "--check", str(path)], check=True, timeout=30)

        expected = {}
        with zipfile.ZipFile(candidate, "x") as target:
            for entry in entries:
                data = new_bytes if entry.filename == member else source.read(entry)
                expected[entry.filename] = digest(data)
                target.writestr(entry, data)

    with zipfile.ZipFile(candidate) as target:
        if {entry.filename: digest(target.read(entry)) for entry in target.infolist()} != expected:
            raise ValueError("candidate-archive-mismatch")
    return {
        "main": str(main), "entryFileSha256": digest(main_bytes),
        "packageSha256": digest(package_bytes), "lockfileSha256": expected.get("package-lock.json"),
        "files": len(expected),
        "changedFile": member, "originalFileSha256": digest(old_bytes),
        "candidateFileSha256": digest(new_bytes),
    }


def stage(output, read_function, gcloud):
    if output.exists():
        raise ValueError("output-already-exists")
    rows = {}
    baselines = {}
    with tempfile.TemporaryDirectory(prefix=".bxh746-stage-", dir=output.parent) as tmp:
        root = Path(tmp)
        payload = root / "packages"
        payload.mkdir()
        for name, (revision, generation, member) in TARGETS.items():
            print("READING " + name, flush=True)
            info, pointer = read_function(name)
            if (pointer[0], pointer[3]) != (revision, generation):
                raise ValueError("source-drift: " + name)
            if info["buildConfig"].get("runtime") != "nodejs22" or info.get("environment") != "GEN_2":
                raise ValueError("runtime-drift: " + name)
            config_hash = snapshot(info)
            baselines[name] = config_hash
            folder = payload / name
            folder.mkdir()
            original, candidate = folder / "original.zip", folder / "candidate.zip"
            _, bucket, obj, _ = pointer
            gcloud("storage", "cp", f"gs://{bucket}/{obj}#{generation}", str(original))
            original_hash = archive_digest(original)
            rows[name] = {
                "revision": revision, "generation": generation,
                "functionSnapshotSha256": config_hash,
                "entryPoint": info["buildConfig"]["entryPoint"], "runtime": "nodejs22",
                "originalArchiveSha256": original_hash,
                **stage_archive(name, member, original, candidate, root / name),
                "candidateArchiveSha256": archive_digest(candidate),
            }
        for name, config_hash in baselines.items():
            info, _ = read_function(name)
            if snapshot(info) != config_hash:
                raise ValueError("function-changed-during-staging: " + name)
        report = {
            "status": "LEGACY_WRITER_PACKAGES_STAGED", "project": "bxh-arena", "region": "asia-east1",
            "productionWrites": 0, "output": str(output), "writers": rows,
        }
        (payload / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        payload.rename(output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    tool = runpy.run_path(str(ROOT / "tools/read-live-writers.py"))
    try:
        report = stage(args.output.resolve(), tool["read_function"], tool["gcloud"])
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "LEGACY_WRITER_STAGING_BLOCKED", "productionWrites": 0,
                          "reason": str(error) if type(error) is ValueError else type(error).__name__}))
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
