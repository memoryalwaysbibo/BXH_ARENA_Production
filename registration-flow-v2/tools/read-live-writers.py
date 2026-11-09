#!/usr/bin/env python3
"""Report source hashes for the existing bxh-arena registration writers."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

PROJECT = "bxh-arena"
REGION = "asia-east1"
WRITERS = (
    "familyRegistration",
    "registrationRosterService",
    "promoteSeatedRegistration",
    "autoPromoteWaitlist",
    "manageOnsiteWaitlist",
    "registrationInvitations",
    "lotteryRegistration",
    "manageRegistrationSelection",
)
HANDLER_NAMES = {
    "family-registration.js", "roster-service.js", "service.cjs",
    "index.js", "index.cjs", "onsite-waitlist-writer-guards.js",
    "package.json", "package-lock.json",
}


def gcloud(*args):
    return subprocess.run(
        ["gcloud", *args, "--project=" + PROJECT, "--quiet"],
        check=True, capture_output=True, timeout=120,
    ).stdout


def read_function(name):
    path = f"projects/{PROJECT}/locations/{REGION}/functions/{name}"
    info = json.loads(gcloud("functions", "describe", name, "--gen2", "--region=" + REGION, "--format=json"))
    build = info.get("buildConfig", {})
    source = build.get("sourceProvenance", {}).get("resolvedStorageSource", {})
    bucket, obj, generation = (source.get(key, "") for key in ("bucket", "object", "generation"))
    revision = info.get("serviceConfig", {}).get("revision")
    if (info.get("name") != path or info.get("state") != "ACTIVE"
            or build.get("entryPoint") != name or not revision
            or not re.fullmatch(r"[a-z0-9][a-z0-9._-]+", bucket)
            or not obj or "#" in obj or not re.fullmatch(r"[0-9]+", str(generation))):
        raise ValueError("unverified-source-pointer")
    return info, (revision, bucket, obj, str(generation))


def describe(name):
    return read_function(name)[1]


def source_hashes(archive, required_files=()):
    result = {}
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            path = PurePosixPath(entry.filename)
            if (path.name not in HANDLER_NAMES and str(path) not in required_files) or "node_modules" in path.parts:
                continue
            if path.is_absolute() or ".." in path.parts or str(path) in result:
                raise ValueError("unexpected-archive-entry")
            if entry.file_size > 16 * 1024 * 1024:
                raise ValueError("archive-entry-too-large")
            result[str(path)] = hashlib.sha256(package.read(entry)).hexdigest()
    if not result:
        raise ValueError("no-application-entries")
    return result


def inspect(name, export_roster=None, required_files=()):
    original = describe(name)
    revision, bucket, obj, generation = original
    with tempfile.TemporaryDirectory(prefix="bxh746-writer-", dir="/tmp") as staging:
        archive = Path(staging) / "source.zip"
        gcloud("storage", "cp", f"gs://{bucket}/{obj}#{generation}", str(archive))
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        files = source_hashes(archive, required_files)
        if export_roster is not None:
            with zipfile.ZipFile(archive) as package:
                roster = package.read('roster-service.js')
    if describe(name) != original:
        raise ValueError("source-changed-during-read")
    if export_roster is not None:
        expected_roster = "c1301d4ccf0c2697e90d7680ae4e935fb7aadb8c76186d0b7240950d118f7b13"
        if (revision != "registrationrosterservice-00010-gaw" or generation != "1794225754757557"
                or files.get("roster-service.js") != expected_roster
                or re.search(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----", roster)):
            raise ValueError("unverified-roster-export")
        with os.fdopen(os.open(export_roster, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
            output.write(roster)
    return {"revision": revision, "generation": generation, "archiveSha256": digest, "files": files}


def waitlist_inventory():
    try:
        rows = json.loads(gcloud("functions", "list", "--regions=" + REGION, "--format=json(name,environment,state,status)"))
    except (OSError, subprocess.SubprocessError, ValueError):
        return {"status": "REGIONAL_LIST_UNAVAILABLE"}
    matches = [row for row in rows if row.get("name", "").rsplit("/", 1)[-1] == "autoPromoteWaitlist"]
    return {"status": "LISTED" if matches else "NOT_LISTED_IN_REGION", "functions": matches}


def verify_release_inputs(manifest_path):
    expected = json.loads(manifest_path.read_text())
    if set(expected) != {"familyRegistration", "registrationRosterService"}:
        raise ValueError("unexpected-release-input-functions")
    results = {}
    for name, baseline in expected.items():
        try:
            live = inspect(name, required_files=baseline["files"])
        except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile) as error:
            results[name] = {"error": str(error) if type(error) is ValueError else type(error).__name__}
            continue
        changed = [field for field in ("revision", "generation") if live[field] != baseline[field]]
        missing = sorted(path for path in baseline["files"] if path not in live["files"])
        mismatches = sorted(path for path, sha in baseline["files"].items()
                            if path in live["files"] and live["files"][path] != sha)
        results[name] = {
            "revision": live["revision"], "generation": live["generation"],
            "archiveSha256": live["archiveSha256"], "checkedFiles": len(baseline["files"]),
            "changed": changed, "missing": missing, "mismatches": mismatches,
            "verified": not (changed or missing or mismatches),
        }
    ready = all(row.get("verified") for row in results.values())
    print(json.dumps({"status": "SOURCE_INPUTS_MATCHED" if ready else "SOURCE_INPUTS_BLOCKED",
                      "productionWrites": 0, "writers": results}, indent=2))
    return 0 if ready else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-roster", type=Path, help="Write the reviewed roster handler to a new local file.")
    parser.add_argument("--verify-release-inputs", type=Path, metavar="MANIFEST",
                        help="Compare the two live application source ZIPs against the reviewed manifest.")
    args = parser.parse_args()
    if args.verify_release_inputs is not None:
        if args.export_roster is not None:
            parser.error("Choose one inspection mode.")
        try:
            return verify_release_inputs(args.verify_release_inputs)
        except (OSError, ValueError, TypeError, KeyError):
            print(json.dumps({"status": "INVALID_RELEASE_INPUT_MANIFEST", "productionWrites": 0}))
            return 1
    if args.export_roster is not None:
        try:
            row = inspect("registrationRosterService", args.export_roster)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, zipfile.BadZipFile) as error:
            print(json.dumps({"status": "ROSTER_EXPORT_STOPPED", "reason": str(error) if type(error) is ValueError else type(error).__name__}))
            return 1
        print(json.dumps({"status": "ROSTER_EXPORTED", "revision": row["revision"],
                          "autoPromoteWaitlist": waitlist_inventory(), "productionWrites": 0}, indent=2))
        return 0
    results = {}
    for name in WRITERS:
        try:
            results[name] = inspect(name)
        except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile) as error:
            results[name] = {"error": str(error) if type(error) is ValueError else type(error).__name__}
    complete = all("archiveSha256" in row for row in results.values())
    print(json.dumps({"status": "WRITER_HASHES" if complete else "PARTIAL_WRITER_HASHES",
                      "productionWrites": 0, "writers": results}, indent=2, sort_keys=True))
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
