#!/usr/bin/env python3
"""Stage the PTN scoring backend on top of the deployed registration source.

Run from an authenticated bxh-arena Cloud Shell. The default is prepare-only;
--apply deploys registrationRosterQueueV2 after all checks pass.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


PROJECT = "bxh-arena"
REGION = "asia-east1"
FUNCTION = "registrationRosterQueueV2"
CODEBASE = "bxh-registration-v2-closed"
FILES = {
    "registration-flow-v2/backend/bindings.cjs": "4ecf3bcbf50245eaf71243a4146f60c533bdd3e3ae4ce2ac9b8b18b19cc0f103",
    "registration-flow-v2/backend/lifecycle.cjs": "1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f",
    "registration-flow-v2/backend/ticket-room-create.cjs": "47ec4f1d0ced6440670e2d9d81a8890b5c14680b068267e0694ad2b6031a81dc",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(*args, cwd=None, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def describe():
    data = json.loads(command("gcloud", "functions", "describe", FUNCTION,
                              "--gen2", "--region=" + REGION,
                              "--project=" + PROJECT, "--format=json", capture=True))
    source = data.get("buildConfig", {}).get("source", {}).get("storageSource", {})
    if (data.get("labels", {}).get("firebase-functions-codebase") != CODEBASE or
            data.get("buildConfig", {}).get("entryPoint") != FUNCTION or
            not all(source.get(x) for x in ("bucket", "object", "generation"))):
        raise ValueError("unexpected live function codebase, entrypoint or source")
    return source["bucket"], source["object"], str(source["generation"])


def stage(archive_path, source_root, release_root):
    source = release_root / "functions"
    source.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate archive entries")
        for info in archive.infolist():
            path = PurePosixPath(info.filename)
            if (path.is_absolute() or ".." in path.parts or
                    (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("unsafe source archive path")
        for path, expected in FILES.items():
            if path not in names or digest(archive.read(path)) != expected:
                raise ValueError("deployed source differs: " + path)
        archive.extractall(source)
    for path in FILES:
        candidate = source_root / path
        if not candidate.is_file():
            raise ValueError("candidate source missing: " + path)
        (source / path).write_bytes(candidate.read_bytes())
    package = json.loads((source / "package.json").read_text())
    if package.get("main") != "index.cjs" or package.get("engines", {}).get("node") != "22":
        raise ValueError("unexpected deployed package entrypoint or runtime")
    entrypoint = (source / "index.cjs").read_text()
    if ("module.exports=createBindings({" not in entrypoint or
            "require('./registration-flow-v2/backend/bindings.cjs')" not in entrypoint):
        raise ValueError("unexpected deployed entrypoint binding")
    (release_root / "firebase.json").write_text(json.dumps({
        "functions": [{"source": "functions", "codebase": CODEBASE, "runtime": "nodejs22"}]
    }, indent=2) + "\n")
    for path in FILES:
        command("node", "--check", str(source / path))
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True, help="Reviewed full PR commit SHA")
    parser.add_argument("--apply", action="store_true", help="Deploy only registrationRosterQueueV2")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.ref):
        parser.error("--ref must be a full Git commit SHA")
    try:
        before = describe()
        with tempfile.TemporaryDirectory(prefix="bxh851-") as temp:
            root = Path(temp)
            checkout = root / "candidate"
            checkout.mkdir()
            command("git", "init", "-q", str(checkout))
            command("git", "-C", str(checkout), "fetch", "-q", "--depth=1",
                    "https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git", args.ref)
            command("git", "-C", str(checkout), "checkout", "-q", "--detach", "FETCH_HEAD")
            if command("git", "-C", str(checkout), "rev-parse", "HEAD", capture=True).strip() != args.ref:
                raise ValueError("candidate commit changed")
            archive = root / "live.zip"
            command("gcloud", "storage", "cp", "gs://" + before[0] + "/" + before[1], str(archive))
            release = root / "release"
            source = stage(archive, checkout, release)
            if describe() != before:
                raise ValueError("live function changed during staging")
            print("BXH851_PREFLIGHT_OK", args.ref, "live generation", before[2], flush=True)
            if not args.apply:
                print("PREPARE_ONLY: no production changes", flush=True)
                return 0
            command("npm", "--prefix", str(source), "install", "--omit=dev", "--ignore-scripts",
                    "--no-audit", "--no-fund")
            if describe() != before:
                raise ValueError("live function changed before deploy")
            env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
            subprocess.run(["firebase", "deploy", "--project", PROJECT,
                            "--config", str(release / "firebase.json"), "--only",
                            "functions:" + FUNCTION, "--non-interactive"],
                           check=True, cwd=release, env=env)
            after = describe()
            if after == before:
                raise ValueError("deploy returned but function source did not change")
            print("BXH851_BACKEND_DEPLOYED", args.ref, "new generation", after[2])
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print("BXH851_STOP:", str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
