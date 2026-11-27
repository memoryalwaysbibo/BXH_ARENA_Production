"""Stage exact legacy writer ZIPs without deployment or production data writes."""
import argparse
import hashlib
import json
import pathlib
import stat
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
PINS = json.loads((ROOT / "writer-pins.json").read_text())
def digest(data):
    return hashlib.sha256(data).hexdigest()
def describe(name):
    d = json.loads(subprocess.check_output(["gcloud","functions","describe",name,"--gen2","--region=asia-east1","--project=bxh-arena","--format=json"],text=True))
    info = d.get("buildConfig", {})
    source = info.get("sourceProvenance", {}).get("resolvedStorageSource", {}) or info.get("source", {}).get("storageSource", {})
    pin = PINS[name]
    if (d.get("serviceConfig", {}).get("revision") != pin["revision"]
            or str(source.get("generation")) != str(pin["generation"])
            or d.get("state") != "ACTIVE" or d.get("environment") != "GEN_2"
            or info.get("entryPoint") != name or not source.get("bucket") or not source.get("object")):
        raise ValueError("live-source-drift: " + name)
    return d, source
def stage_archive(name, original, candidate):
    pin = PINS[name]
    with zipfile.ZipFile(original) as src:
        entries = src.infolist()
        if len(entries) != len({e.filename for e in entries}) or sum(e.file_size for e in entries)>128*1024*1024:
            raise ValueError("invalid-archive-inventory")
        for entry in entries:
            p = pathlib.PurePosixPath(entry.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in entry.filename or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("unsafe-archive-entry")
        package = json.loads(src.read("package.json"))
        main = package.get("main", "index.js")
        if main == pin["path"] or main not in {e.filename for e in entries}:
            raise ValueError("invalid-entrypoint")
        old = src.read(pin["path"])
        if digest(old) != pin["sha256"]:
            raise ValueError("handler-source-drift")
        with tempfile.TemporaryDirectory() as tmp:
            handler = pathlib.Path(tmp) / pathlib.Path(pin["path"]).name
            handler.write_bytes(old)
            new = subprocess.check_output(["node","-e",
                "const fs=require('node:fs');const p=require(process.argv[1]);process.stdout.write(p.prepare(process.argv[2],fs.readFileSync(process.argv[3],'utf8')));",
                str(ROOT/"prepare-writers.cjs"),name,str(handler)],timeout=30)
            handler.write_bytes(new)
            subprocess.run(["node","--check",str(handler)],check=True,timeout=30)
        expected = {}
        with zipfile.ZipFile(candidate,"x") as dst:
            for entry in entries:
                data = new if entry.filename == pin["path"] else src.read(entry)
                expected[entry.filename] = digest(data)
                dst.writestr(entry,data)
        with zipfile.ZipFile(candidate) as dst:
            if {e.filename:digest(dst.read(e)) for e in dst.infolist()} != expected:
                raise ValueError("candidate-archive-mismatch")
    if new == old:
        raise ValueError("handler-not-changed")
    return {"changedFile":pin["path"],"originalHandler":digest(old),"candidateHandler":digest(new),
            "originalArchive":digest(original.read_bytes()),"candidateArchive":digest(candidate.read_bytes()),"entries":len(expected)}
def stage(output):
    output.mkdir()
    manifest = {}
    snapshots = {}
    for name in PINS:
        d, source = describe(name)
        snapshots[name] = digest(json.dumps(d,sort_keys=True).encode())
        folder = output / name
        folder.mkdir()
        original, candidate = folder/"original.zip", folder/"candidate.zip"
        subprocess.run(["gcloud","storage","cp","gs://"+source["bucket"]+"/"+source["object"]+"#"+str(source["generation"]),str(original)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        manifest[name] = {**PINS[name],**stage_archive(name,original,candidate),"functionSnapshotSha256":snapshots[name]}
    for name, fingerprint in snapshots.items():
        if digest(json.dumps(describe(name)[0],sort_keys=True).encode()) != fingerprint:
            raise ValueError("configuration-drift-during-stage: "+name)
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output",required=True,type=pathlib.Path)
    stage(parser.parse_args().output)
