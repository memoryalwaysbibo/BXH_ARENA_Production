#!/usr/bin/env python3
"""Deploy only the PTN read diagnostic onto the pinned live roster callable.

Prepare-only by default. Run in authenticated bxh-arena Cloud Shell.
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
REF = "c4492d9812ae286ce5a0b9629e4651cf114603cf"
GENERATION = "1795332404902579"
PATH = "registration-flow-v2/backend/bindings.cjs"
LIVE_SHA = "1367bc9473bc3635d83db8975c515bc1037cdfb496a0fb038b83a4e4205c775f"
DIAGNOSTIC = b"""   if(data?.action==='ticket-room-state'&&isPartnerRoomCode(data?.code)){
     // Record only error classification and source location. Never log room state,
     // request payload, player identity or the exception message.
     const frame=String(error?.stack||'').split('\\n').slice(1)
      .map(line=>line.match(/(?:backend|engine)\\/[A-Za-z0-9_./-]+\\.cjs:\\d+:\\d+/)?.[0])
      .find(Boolean)||'unknown';
     const type=String(error?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,40)||'Error';
     const code=String(error?.code??'').replace(/[^A-Za-z0-9/_-]/g,'').slice(0,40);
     console.error('PTN room state read failed',{type,code,frame});
   }
"""
ANCHOR = b"   throw new HttpsError('unavailable','registration-operation-unconfirmed');\n"


def run(*args, capture=False, cwd=None):
    result = subprocess.run(args, check=True, cwd=cwd, text=True,
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
        if len(names) != len(set(names)) or PATH not in names:
            raise ValueError("unsafe or incomplete source archive")
        for info in infos:
            name = PurePosixPath(info.filename)
            if (name.is_absolute() or ".." in name.parts or
                    (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("unsafe source archive path")
        live = archive.read(PATH)
        if hashlib.sha256(live).hexdigest() != LIVE_SHA:
            raise ValueError("deployed bindings differ")
        candidate = (candidate_root / PATH).read_bytes()
        if candidate.count(DIAGNOSTIC) != 1 or candidate.replace(DIAGNOSTIC, b"", 1) != live:
            raise ValueError("candidate differs beyond reviewed diagnostic")
        if live.count(ANCHOR) != 1 or candidate != live.replace(ANCHOR, DIAGNOSTIC + ANCHOR, 1):
            raise ValueError("diagnostic insertion location changed")
        archive.extractall(source)
    (source / PATH).write_bytes(candidate)
    package = json.loads((source / "package.json").read_text())
    if package.get("main") != "index.cjs" or package.get("engines", {}).get("node") != "22":
        raise ValueError("unexpected package runtime")
    (release_root / "firebase.json").write_text(json.dumps({
        "functions": [{"source": "functions", "codebase": CODEBASE, "runtime": "nodejs22"}]
    }, indent=2) + "\n")
    run("node", "--check", str(source / PATH))
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        before = describe()
        if before[2] != GENERATION:
            raise ValueError("live source generation changed")
        with tempfile.TemporaryDirectory(prefix="bxh857-") as temp:
            root = Path(temp)
            checkout = root / "candidate"
            checkout.mkdir()
            run("git", "init", "-q", str(checkout))
            run("git", "-C", str(checkout), "fetch", "-q", "--depth=1",
                "https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git", REF)
            run("git", "-C", str(checkout), "checkout", "-q", "--detach", "FETCH_HEAD")
            if run("git", "-C", str(checkout), "rev-parse", "HEAD", capture=True).strip() != REF:
                raise ValueError("candidate ref changed")
            archive = root / "live.zip"
            run("gcloud", "storage", "cp", "gs://" + before[0] + "/" + before[1], str(archive))
            release = root / "release"
            source = stage(archive, checkout, release)
            if describe() != before:
                raise ValueError("live function changed during staging")
            print("BXH857_PREFLIGHT_OK", REF, "generation", GENERATION, flush=True)
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
                raise ValueError("deploy returned but source did not change")
            print("BXH857_BACKEND_DEPLOYED", REF, "generation", after[2])
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as exc:
        print("BXH857_STOP:", str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
