"""Prepare local #822 candidates from the six verified revisions."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

PROJECT = "bxh-arena"
BASE = "32b46982756ea5b42890859c5bbd79dcef2bd7d7"
CANDIDATE = "2cee2efaebefcd876103aeac3cd1ffd6c604f427"
BUCKET = "gcf-v2-sources-87261141693-asia-east1"
BACKEND = "registration-flow-v2/backend/"
FAMILY = "writer-inputs/familyRegistration/family-registration.js"
VERSIONS = {
    "registrationQueueV2": ("registrationqueuev2-00005-qut", "1794386273943718"),
    "registrationRosterQueueV2": ("registrationrosterqueuev2-00005-vit", "1794386322278473"),
    "registrationDrawV2": ("registrationdrawv2-00005-bed", "1794387276841041"),
    "registrationStartV2": ("registrationstartv2-00005-dop", "1794387325357496"),
    "registrationQueueV2Worker": ("registrationqueuev2worker-00006-wax", "1794472594588237"),
    "registrationQueueV2Sweep": ("registrationqueuev2sweep-00006-mez", "1794472646255418"),
}
COMMON = {
    "api.cjs": "cbe362e82cf17ec4a4a88108accc0abe3522eeb8a228ca5642362526e502ce71",
    "lifecycle.cjs": "2d167aa055c7969cd9ce344464b98c7d7e0cefcac20ea4fcef8a1b4718e2c7f0",
    "prepare-family.cjs": "8f2e90834da7e509a331b0a5f9b7afbc70471a12a936a7784839a45d8769414f",
}
OLDER = {
    "bindings.cjs": "90c613af61bcf80726929038390ad58bbb326c3368c5e740d7ac2a16a4ea1d7f",
    "queue.cjs": "626dd33ed4b7adb3becb53719c5aad02255965f11260f0a0855f112ee7b4543c",
}
WORKERS = {
    "bindings.cjs": "9f25e4f5faab8b606f39c17139649a708112ef4a3c00ac993c3c7de4e204a194",
    "queue.cjs": "804a3ebed9f7842c3a18c404abc5aa9d41d259a7f9ef51b8ee46925f27b932b8",
}
EXTRA = ("ticket-host.cjs", "ticket-room-create.cjs")


def output(*args, cwd=None, input=None):
    return subprocess.run(args, cwd=cwd, input=input, stdout=subprocess.PIPE,
                          check=True).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def need(condition, label):
    if not condition:
        raise ValueError(label)


def describe(name):
    return json.loads(output("gcloud", "functions", "describe", name, "--gen2",
                             "--project=" + PROJECT, "--region=asia-east1", "--format=json"))


def source_pointer(name, info):
    source = info["buildConfig"]["source"]["storageSource"]
    obj = f"{name}/function-source.zip"
    revision, generation = VERSIONS[name]
    need(info["state"] == "ACTIVE" and info["serviceConfig"]["revision"] == revision
         and source["bucket"] == BUCKET and source["object"] == obj
         and str(source["generation"]) == generation, f"{name}: live source changed")
    return f"gs://{BUCKET}/{obj}#{generation}"


def git_source(repo, ref, filename):
    return output("git", "show", f"{ref}:{BACKEND}{filename}", cwd=repo)


def merge_source(live, base, candidate, name):
    if live == base:
        return candidate
    with tempfile.TemporaryDirectory() as work:
        for label, content in (("live", live), ("base", base), ("candidate", candidate)):
            (Path(work) / label).write_bytes(content)
        merged = subprocess.run(
            ["git", "merge-file", "-p", "live", "base", "candidate"],
            cwd=work, stdout=subprocess.PIPE,
        )
    need(merged.returncode == 0, f"{name}: merge conflict")
    return merged.stdout


def queue_source(live, base, candidate):
    """Apply the ticket hunks without moving the release's worker timing code."""
    def replace_once(source, before, after):
        need(source.count(before) == 1, "queue.cjs: ticket patch anchor changed")
        return source.replace(before, after, 1)

    import_anchor = b"const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');\n"
    next_import = b"const digest="
    import_change = candidate.split(import_anchor, 1)[1].split(next_import, 1)[0]
    commentary = b"// rollout. Queue acceptance is NOT a reservation or proof of registration.\n"
    helper = candidate.split(commentary, 1)[1].split(b"function createQueue(", 1)[0]
    before_guard = b"     if(requireRoomOwnership&&!registrationQueueOwnsRoom(room?.data()))throw fail('registration-queue-disabled');\n"
    guard_change = b"     const currentRoom=room?.data();\n"
    after_guard = b"     // The operation result and all registration mutations commit atomically.\n"
    guard = guard_change + candidate.split(guard_change, 1)[1].split(after_guard, 1)[0]
    before_exports = b"module.exports={createQueue,validate,businessRejections,safeResult};"
    after_exports = b"module.exports={authorizeTicketRemoval,createQueue,validate,businessRejections,safeResult};"

    def apply(source):
        source = replace_once(source, import_anchor, import_anchor + import_change)
        source = replace_once(source, commentary, commentary + helper)
        source = replace_once(source, before_guard, guard)
        return replace_once(source, before_exports, after_exports)

    need(apply(base) == candidate, "queue.cjs: ticket patch differs from #822")
    return apply(live)


def family_source(live, patcher):
    need(digest(live) == "92facece6ca742aaa4e0e375a2fcbb9e6b9c47449f8ae790f6fe95f5dde72d",
         "family writer changed")
    lines = patcher.decode().splitlines(keepends=True)
    start = [i for i, line in enumerate(lines) if "'  const quick=quickPolicy" in line]
    end = [i for i, line in enumerate(lines) if "patch('module.exports={createFamilyRegistration};'" in line]
    need(len(start) == len(end) == 1 and 0 < start[0] < end[0], "family patch anchors")
    block = "".join(lines[start[0] - 1:end[0]])
    runner = r"""
    let source=require('node:fs').readFileSync(0,'utf8');
    const patch=(before,after)=>{
      if(source.split(before).length!==2)throw Error('family-source-patch-mismatch');
      source=source.replace(before,after);
    };
    """
    return output("node", "-e", runner + block + "process.stdout.write(source);", input=live)


def prepare(name, original, repo):
    replacements = {}
    expected = {**COMMON, **(WORKERS if name.endswith(("Worker", "Sweep")) else OLDER)}
    with zipfile.ZipFile(original) as source:
        names = source.namelist()
        need(len(names) == len(set(names)), f"{name}: duplicate ZIP entry")
        need(digest(source.read("index.cjs")) ==
             "9da2c826e2c66d327bcc7e35e07325fb844f1ea637dae6d22bae3156bdd29f71",
             f"{name}: entrypoint changed")
        need(digest(source.read("referee-seats/functions/engine/index.cjs")) ==
             "bbb55f4a6212f3ed8f9c9d40269ffed44e937cdf207004a54ee192c60e69da0a",
             f"{name}: bracket engine changed")
        for filename, sha in expected.items():
            path = BACKEND + filename
            live = source.read(path)
            need(digest(live) == sha, f"{name}: {filename} changed")
            base = git_source(repo, BASE, filename)
            candidate = git_source(repo, CANDIDATE, filename)
            replacements[path] = (queue_source(live, base, candidate) if filename == "queue.cjs"
                                  else merge_source(live, base, candidate, filename))
        for filename in EXTRA:
            path = BACKEND + filename
            need(path not in names, f"{name}: {filename} already exists")
            replacements[path] = git_source(repo, CANDIDATE, filename)
        replacements[FAMILY] = family_source(source.read(FAMILY), replacements[BACKEND + "prepare-family.cjs"])
        for data in replacements.values():
            output("node", "--check", input=data)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as result:
            for entry in source.infolist():
                payload = replacements[entry.filename] if entry.filename in replacements else source.read(entry)
                result.writestr(entry, payload)
            for filename in EXTRA:
                path = BACKEND + filename
                result.writestr(path, replacements[path])
        with zipfile.ZipFile(buffer) as result:
            need(set(result.namelist()) == set(names) | replacements.keys(), f"{name}: ZIP layout")
            for path in names:
                if path not in replacements:
                    need(result.read(path) == source.read(path), f"{name}: unexpected change in {path}")
    return buffer.getvalue()


def main(repo, directory):
    need(not directory.exists(), "output already exists")
    with tempfile.TemporaryDirectory(prefix=".bxh822-", dir=directory.parent) as temporary:
        stage = Path(temporary) / "stage"
        stage.mkdir(mode=0o700)
        manifest = {}
        for name, (revision, generation) in VERSIONS.items():
            pointer = source_pointer(name, describe(name))
            original = stage / f"{name}.original.zip"
            output("gcloud", "storage", "cp", pointer, str(original), "--quiet", "--project=" + PROJECT)
            candidate = prepare(name, original, repo)
            (stage / f"{name}.candidate.zip").write_bytes(candidate)
            manifest[name] = {"revision": revision, "generation": generation,
                              "originalSha256": digest(original.read_bytes()),
                              "candidateSha256": digest(candidate)}
            print(f"{name}: candidate prepared", flush=True)
        for name in VERSIONS:
            source_pointer(name, describe(name))
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        stage.rename(directory)
    print(f"BXH822_STAGED {directory}")


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]).resolve(strict=True), Path(sys.argv[2]).resolve())
    except (IndexError, KeyError, ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as exc:
        sys.exit(f"BXH822_STAGE_STOPPED {exc}")
