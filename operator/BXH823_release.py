"""Deploy only the #823 bindings change over the verified #822 archives."""
import argparse
from copy import copy
import fcntl
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
from zipfile import ZipFile

from BXH822_release import ORDER, assert_pilot_closed, load_publisher
import BXH822_stage_fixed as stage

REVISION = "f1f3fae118a0d9d73678b72ef67b05cb275e6231"
BINDINGS = stage.BACKEND + "bindings.cjs"


def overlay(name, original, repo):
    base = stage.git_source(repo, stage.CANDIDATE, "bindings.cjs")
    candidate = stage.git_source(repo, REVISION, "bindings.cjs")
    with ZipFile(BytesIO(original)) as source:
        entries = source.namelist()
        stage.need(len(entries) == len(set(entries)) and BINDINGS in entries,
                   f"{name}: source ZIP layout")
        update = stage.merge_source(source.read(BINDINGS), base, candidate, name)
        stage.output("node", "--check", input=update)
        raw = BytesIO()
        with ZipFile(raw, "w") as result:
            result.comment = source.comment
            for entry in source.infolist():
                data = update if entry.filename == BINDINGS else source.read(entry)
                result.writestr(copy(entry), data)
        with ZipFile(raw) as result:
            stage.need(result.namelist() == entries and result.testzip() is None
                       and result.read(BINDINGS) == update, f"{name}: candidate ZIP layout")
            for path in entries:
                if path != BINDINGS:
                    stage.need(result.read(path) == source.read(path), f"{name}: changed {path}")
    return raw.getvalue()


def prepare(repo, directory, publisher):
    old = repo / "staged"
    path = directory / "plan.json"
    plan = json.loads(path.read_text()) if path.exists() else {}
    stage.need(not plan or set(plan) == set(ORDER), "release plan function scope")
    updating = {}
    for name in ORDER:
        receipt = json.loads((old / f"{name}.release.json").read_text())
        original = (old / f"{name}.candidate.zip").read_bytes()
        archive_hash = stage.digest(original)
        previous_manifest = json.loads((old / "manifest.json").read_text())
        stage.need(receipt["status"] == "complete"
                   and archive_hash == previous_manifest[name]["candidateSha256"],
                   f"{name}: missing verified #822 archive")
        backup = old / f"{name}.verified.zip"
        stage.need(backup.is_file() and stage.digest(backup.read_bytes()) == archive_hash,
                   f"{name}: verified #822 source differs")
        candidate = overlay(name, original, repo)
        candidate_path = directory / f"{name}.candidate.zip"
        if plan:
            row = plan[name]
            stage.need(row["beforeRevision"] == receipt["resultRevision"]
                       and row["beforeSource"] == receipt["resultSource"]
                       and row["candidateSha256"] == stage.digest(candidate)
                       and candidate_path.read_bytes() == candidate, f"{name}: release plan differs")
        else:
            info = publisher.api(publisher.PARENT + "/functions/" + name)
            publisher.validate(info, name)
            stage.need(info["serviceConfig"]["revision"] == receipt["resultRevision"]
                       and publisher.source(info) == receipt["resultSource"],
                       f"{name}: live #822 revision or source changed")
            updating[name] = {"beforeRevision": receipt["resultRevision"],
                              "beforeSource": receipt["resultSource"],
                              "candidateSha256": stage.digest(candidate),
                              "protectedSha256": publisher.digest(publisher.protected(info))}
            candidate_path.write_bytes(candidate)
    if updating:
        publisher.save(path, updating)
    return plan or updating


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    repo = args.repo.resolve(strict=True)
    directory = repo / "staged-823"
    directory.mkdir(exist_ok=True)
    with (directory / ".lock").open("a") as lock, tempfile.TemporaryDirectory() as temp:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publisher = load_publisher(repo, Path(temp))
        assert_pilot_closed()
        plan = prepare(repo, directory, publisher)
        for name in ORDER:
            publisher.release(directory, name, plan[name])
        if args.apply:
            for name in ORDER:
                assert_pilot_closed()
                result = publisher.release(directory, name, plan[name], apply=True)
                print(f"{name}: {result['revision']} verified", flush=True)
            print("BXH823_DEPLOYED", flush=True)
        else:
            print("BXH823_RELEASE_CHECKED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, ValueError) else type(error).__name__
        sys.exit(f"BXH823_RELEASE_STOPPED {detail}")
