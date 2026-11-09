#!/usr/bin/env python3
"""Report source hashes for the existing bxh-arena registration writers."""

import hashlib
import json
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


def describe(name):
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
    return revision, bucket, obj, str(generation)


def source_hashes(archive):
    result = {}
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            path = PurePosixPath(entry.filename)
            if path.name not in HANDLER_NAMES or "node_modules" in path.parts:
                continue
            if path.is_absolute() or ".." in path.parts or str(path) in result:
                raise ValueError("unexpected-archive-entry")
            if entry.file_size > 16 * 1024 * 1024:
                raise ValueError("archive-entry-too-large")
            result[str(path)] = hashlib.sha256(package.read(entry)).hexdigest()
    if not result:
        raise ValueError("no-application-entries")
    return result


def inspect(name):
    original = describe(name)
    revision, bucket, obj, generation = original
    with tempfile.TemporaryDirectory(prefix="bxh746-writer-", dir="/tmp") as staging:
        archive = Path(staging) / "source.zip"
        gcloud("storage", "cp", f"gs://{bucket}/{obj}#{generation}", str(archive))
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        files = source_hashes(archive)
    if describe(name) != original:
        raise ValueError("source-changed-during-read")
    return {"revision": revision, "generation": generation, "archiveSha256": digest, "files": files}


def main():
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
