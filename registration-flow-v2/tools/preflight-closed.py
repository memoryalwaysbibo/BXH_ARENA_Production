#!/usr/bin/env python3
"""Read-only preflight for creating the six hard-closed V2 functions."""

import argparse
import hashlib
import json
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

PROJECT = "bxh-arena"
REGION = "asia-east1"
COMMIT = "1aaf11973a44c60e00b3053cca0fce557b0fc21a"
BUNDLE_SHA = "187a557f4058a282f48de7cdf9e605db4a7cb8669646474334f79b0de120dae4"
INDEX_SHA = "47ea970fbfc95a3e994fa7d360707da09a6f77b6594ad8062dc22671454067e3"
FUNCTIONS = (
    "registrationQueueV2", "registrationRosterQueueV2", "registrationQueueV2Worker",
    "registrationQueueV2Sweep", "registrationDrawV2", "registrationStartV2",
)
WRITERS = {
    "familyRegistration": ("familyregistration-00041-ded", "1793854788506302"),
    "registrationRosterService": ("registrationrosterservice-00009-sep", "1793639756822602"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check_bundle(root):
    manifest = json.loads((root / "manifest.json").read_text())
    if (manifest.get("candidateCommit") != COMMIT or manifest.get("activation") != "HARD_CLOSED"
            or manifest.get("entrypoints") != list(FUNCTIONS)
            or manifest.get("productionWrites") != 0):
        raise ValueError("unexpected-bundle-manifest")
    archive = root / "function-source.zip"
    with archive.open("rb") as stream:
        archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    if archive_sha != BUNDLE_SHA or manifest.get("bundleSha256") != BUNDLE_SHA:
        raise ValueError("bundle-sha256-mismatch")
    indexes_sha = digest((root / "firestore-indexes.candidate.json").read_bytes())
    if indexes_sha != INDEX_SHA or manifest.get("candidateIndexesSha256") != INDEX_SHA:
        raise ValueError("candidate-index-sha256-mismatch")
    with zipfile.ZipFile(archive) as package:
        files = {}
        for entry in package.infolist():
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or entry.filename in files
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.is_dir()):
                raise ValueError("unexpected-bundle-entry")
            files[entry.filename] = digest(package.read(entry))
        if files != manifest.get("files") or len(files) != 46:
            raise ValueError("bundle-file-manifest-mismatch")
        if b"stagedOnly:true" not in package.read("index.cjs"):
            raise ValueError("staging-gate-not-found")
    return {"candidateCommit": COMMIT, "bundleSha256": archive_sha, "verifiedFiles": len(files)}


def gcloud(*args):
    result = subprocess.run(
        ["gcloud", *args, "--project=" + PROJECT, "--quiet", "--format=json"],
        check=True, capture_output=True, timeout=90,
    )
    return json.loads(result.stdout)


def check_live(read=gcloud):
    project = read("projects", "describe", PROJECT)
    if project.get("projectId") != PROJECT or project.get("lifecycleState") != "ACTIVE":
        raise ValueError("unexpected-target-project")
    functions = read("functions", "list", "--regions=" + REGION)
    if not isinstance(functions, list):
        raise ValueError("unexpected-function-inventory")
    collisions = sorted({row["name"].rsplit("/", 1)[-1] for row in functions} & set(FUNCTIONS))
    if collisions:
        raise ValueError("creation-target-already-exists: " + ", ".join(collisions))
    versions = {}
    for name, expected in WRITERS.items():
        live = read("functions", "describe", name, "--gen2", "--region=" + REGION)
        build = live.get("buildConfig", {})
        revision = live.get("serviceConfig", {}).get("revision")
        source = build.get("sourceProvenance", {}).get("resolvedStorageSource", {})
        generation = str(source.get("generation", ""))
        if (live.get("name") != f"projects/{PROJECT}/locations/{REGION}/functions/{name}"
                or live.get("state") != "ACTIVE" or build.get("entryPoint") != name
                or (revision, generation) != expected):
            raise ValueError("production-writer-drift: " + name)
        versions[name] = {"revision": revision, "generation": generation}
    return {"project": PROJECT, "region": REGION, "newFunctions": FUNCTIONS, "sourceWriters": versions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle_dir", type=Path)
    args = parser.parse_args()
    try:
        package = check_bundle(args.bundle_dir)
        production = check_live()
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "CLOSED_DEPLOY_PREFLIGHT_BLOCKED", "productionWrites": 0,
                          "reason": str(error) if type(error) is ValueError else type(error).__name__}))
        return 1
    print(json.dumps({"status": "CLOSED_DEPLOY_PREFLIGHT_PASSED", "activation": "HARD_CLOSED",
                      "productionWrites": 0, **package, **production}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
