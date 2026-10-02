#!/usr/bin/env python3
"""M2-1: stage the Card Album CSS extraction in a NEW directory only."""
import argparse, hashlib, json, shutil
from pathlib import Path

BASE_COMMIT="f5a890b831d3bb736df0022829c08a89987f6c1f"
BASE_INDEX_BLOB="f5c5d2205d26aeedd340c8a822b4f3fecefa377b"
CANDIDATE_INDEX_BLOB="52a33590b3ca5a9d118aaeae70cd9d16f78baceb"
CSS_SHA256="034f6ce6fe55540c7a495d23480ad9723795df374a9e5bf1cde91afdde5f2789"
OPEN="<style>\n.card-album-head"
CLOSE="</style>"
LINK='<link rel="stylesheet" href="modules/card-album/styles.css?v=20261002-m2-1">'

def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()

def stage(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents or output in source.parents:
        raise ValueError("output must be outside source tree")
    if output.exists():
        raise ValueError("output already exists")
    raw=(source/"index.html").read_bytes()
    if git_blob(raw) != BASE_INDEX_BLOB:
        raise ValueError("index baseline changed; re-review before M2 extraction")
    text=raw.decode("utf-8")
    if text.count(OPEN) != 1:
        raise ValueError("expected exactly one Card Album style block")
    start=text.index(OPEN)
    end=text.index(CLOSE,start)+len(CLOSE)
    block=text[start:end]
    css=block[len("<style>\n"):-len(CLOSE)]
    if "url(" in css.lower():
        raise ValueError("relative URL found; path semantics require manual review")
    if hashlib.sha256(css.encode()).hexdigest() != CSS_SHA256:
        raise ValueError("Card Album CSS baseline changed")
    if text.count(LINK):
        raise ValueError("candidate link already exists in baseline")
    candidate=(text[:start]+LINK+text[end:]).encode()
    if git_blob(candidate) != CANDIDATE_INDEX_BLOB:
        raise ValueError("candidate index digest mismatch")
    shutil.copytree(source, output, ignore=shutil.ignore_patterns(".git","node_modules","__pycache__"))
    target=output/"modules/card-album/styles.css"
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(css,encoding="utf-8")
    (output/"index.html").write_bytes(candidate)
    manifest={
      "status":"STAGED_ONLY_NOT_DEPLOYED",
      "parent_m1_commit":BASE_COMMIT,
      "source_index_blob":BASE_INDEX_BLOB,
      "candidate_index_blob":CANDIDATE_INDEX_BLOB,
      "css_sha256":CSS_SHA256,
      "source_index_bytes":len(raw),
      "candidate_index_bytes":len(candidate),
      "extracted_css_bytes":len(css.encode()),
      "stylesheet":"modules/card-album/styles.css",
      "relative_urls":0
    }
    (output/"m2-card-album-css-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return manifest

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    try:
        print(json.dumps(stage(a.source,a.output),ensure_ascii=False,indent=2))
    except (OSError,ValueError) as e:
        p.exit(1,"M2 STAGING BLOCKED: "+str(e)+"\n")
