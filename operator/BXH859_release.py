#!/usr/bin/env python3
"""Stage the PTN scoring gate fix onto the pinned live roster callable.

Prepare-only by default. Run in authenticated bxh-arena Cloud Shell.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

PROJECT = "bxh-arena"
REGION = "asia-east1"
FUNCTION = "registrationRosterQueueV2"
CODEBASE = "bxh-registration-v2-closed"
REF = "2f47f89ce717af00dfc104c1fa6c90780fd7d0f7"
GENERATION = "1795415508089506"
BASE = "registration-flow-v2/backend/"
LIVE = {
    BASE + "lifecycle.cjs": "60e13401e0488863cc76c5f82fd6e05ed7c1fb1ea02f4469b23d4eb3a7c69385",
    BASE + "ticket-room-create.cjs": "31eafa09fa3e57aca3f844535324c83f52302da66ea62ffb9582f584b02f1ec8",
}
CANDIDATE = {
    BASE + "lifecycle.cjs": "5feee59bb69bd5c4766a0a53e3d553cccb92a558f48281bd51eeed71dfb44d8c",
    BASE + "ticket-room-create.cjs": "368e3f87dfeb397a2d86832909f77d6f5b701482c2078682d870e314fefb9edc",
}
DIAGNOSTIC_BINDINGS = "ec10fe166bfdf45ad6b58ac92db5c9367bd9e93ac123a7b20cea4c01b342a921"
BINDINGS = BASE + "bindings.cjs"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(*args, capture=False, cwd=None):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def describe():
    data = json.loads(run("gcloud", "functions", "describe", FUNCTION, "--gen2",
                          "--region=" + REGION, "--project=" + PROJECT,
                          "--format=json", capture=True))
    source = data.get("buildConfig", {}).get("source", {}).get("storageSource", {})
    if (data.get("labels", {}).get("firebase-functions-codebase") != CODEBASE or
            data.get("buildConfig", {}).get("entryPoint") != FUNCTION or
            not all(source.get(k) for k in ("bucket", "object", "generation"))):
        raise ValueError("unexpected live function")
    return source["bucket"], source["object"], str(source["generation"])


def stage(archive_path, candidate_root, release_root):
    source = release_root / "functions"
    source.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)) or any(p not in names for p in (*LIVE, BINDINGS)):
            raise ValueError("unsafe or incomplete source archive")
        for info in infos:
            path = PurePosixPath(info.filename)
            if (path.is_absolute() or ".." in path.parts or
                    (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("unsafe source archive path")
        if digest(archive.read(BINDINGS)) != DIAGNOSTIC_BINDINGS:
            raise ValueError("live diagnostic bindings changed")
        for path, expected in LIVE.items():
            if digest(archive.read(path)) != expected:
                raise ValueError("deployed source differs: " + path)
            candidate = candidate_root / path
            if not candidate.is_file() or digest(candidate.read_bytes()) != CANDIDATE[path]:
                raise ValueError("candidate source differs: " + path)
        archive.extractall(source)
    for path in LIVE:
        (source / path).write_bytes((candidate_root / path).read_bytes())
    package = json.loads((source / "package.json").read_text())
    if package.get("main") != "index.cjs" or package.get("engines", {}).get("node") != "22":
        raise ValueError("unexpected package runtime")
    (release_root / "firebase.json").write_text(json.dumps({
        "functions": [{"source": "functions", "codebase": CODEBASE, "runtime": "nodejs22"}]
    }, indent=2) + "\n")
    for path in LIVE:
        run("node", "--check", str(source / path))
    if digest((source / BINDINGS).read_bytes()) != DIAGNOSTIC_BINDINGS:
        raise ValueError("diagnostic bindings were not preserved")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        before = describe()
        if before[2] != GENERATION:
            raise ValueError("live source generation changed")
        with tempfile.TemporaryDirectory(prefix="bxh859-") as temp:
            root = Path(temp)
            checkout = root / "candidate"
            checkout.mkdir()
            run("git", "init", "-q", str(checkout))
            run("git", "-C", str(checkout), "fetch", "-q", "--depth=1",
                "https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git", REF)
            run("git", "-C", str(checkout), "checkout", "-q", "--detach", "FETCH_HEAD")
            if run("git", "-C", str(checkout), "rev-parse", "HEAD", capture=True).strip() != REF:
                raise ValueError("candidate commit changed")
            archive = root / "live.zip"
            run("gcloud", "storage", "cp", "gs://" + before[0] + "/" + before[1], str(archive))
            release = root / "release"
            source = stage(archive, checkout, release)
            if describe() != before:
                raise ValueError("live function changed during staging")
            print("BXH859_PREFLIGHT_OK", REF, "generation", GENERATION, flush=True)
            if not args.apply:
                print("PREPARE_ONLY: no production changes", flush=True)
                return 0
            run("npm", "--prefix", str(source), "install", "--omit=dev", "--ignore-scripts",
                "--no-audit", "--no-fund")
            if describe() != before:
                raise ValueError("live function changed before deploy")
            env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
            subprocess.run(["firebase", "deploy", "--project", PROJECT,
                            "--config", str(release / "firebase.json"), "--only",
                            f"functions:{CODEBASE}:{FUNCTION}", "--non-interactive"],
                           check=True, cwd=release, env=env)
            after = describe()
            if after == before:
                raise ValueError("deploy returned but function source did not change")
            print("BXH859_BACKEND_DEPLOYED", REF, "generation", after[2])
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print("BXH859_STOP:", str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
