#!/usr/bin/env python3
import argparse,hashlib,json,shutil
from pathlib import Path
BASE_INDEX_BLOB="52a33590b3ca5a9d118aaeae70cd9d16f78baceb"
CANDIDATE_INDEX_BLOB="4a3a7e900ac9e9aaa6c706e65bb170e832c1bc20"
CSS_SHA256="94bb93aabec246e2adb097f3303b20dd6f7d930821621d5bd7f0251d44ad3eb6"
OPEN='<style id="directive-warning-critical-v1">'
CLOSE='</style>'
LINK='<link id="directive-warning-critical-v1" rel="stylesheet" href="modules/theme-directive/styles.css?v=20261002-m2-2">'
def blob(b): return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def main(src,out):
 src,out=src.resolve(),out.resolve()
 if out==src or src in out.parents or out in src.parents: raise ValueError("output must be outside source")
 if out.exists(): raise ValueError("output exists")
 raw=(src/"index.html").read_bytes()
 if blob(raw)!=BASE_INDEX_BLOB: raise ValueError("index baseline changed")
 t=raw.decode()
 if t.count(OPEN)!=1: raise ValueError("Directive critical style marker count changed")
 a=t.index(OPEN); b=t.index(CLOSE,a)+len(CLOSE)
 css=t[a+len(OPEN):b-len(CLOSE)]
 if hashlib.sha256(css.encode()).hexdigest()!=CSS_SHA256: raise ValueError("Directive CSS changed")
 if "url(" in css.lower(): raise ValueError("relative URL requires review")
 cand=(t[:a]+LINK+t[b:]).encode()
 actual=blob(cand)
 if actual!=CANDIDATE_INDEX_BLOB: raise ValueError("candidate digest mismatch: "+actual+" bytes="+str(len(cand)))
 shutil.copytree(src,out,ignore=shutil.ignore_patterns(".git","node_modules","__pycache__"))
 p=out/"modules/theme-directive/styles.css";p.parent.mkdir(parents=True,exist_ok=True);p.write_text(css,encoding="utf-8")
 (out/"index.html").write_bytes(cand)
 manifest={"status":"STAGED_ONLY_NOT_DEPLOYED","source_index_blob":BASE_INDEX_BLOB,"candidate_index_blob":CANDIDATE_INDEX_BLOB,"css_sha256":CSS_SHA256,"source_index_bytes":len(raw),"candidate_index_bytes":len(cand),"css_bytes":len(css.encode()),"stylesheet":"modules/theme-directive/styles.css","relative_urls":0}
 (out/"m2-directive-css-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps(manifest,ensure_ascii=False,indent=2))
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--source",type=Path,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
 try: main(a.source,a.output)
 except (OSError,ValueError) as e:p.exit(1,"M2-2 BLOCKED: "+str(e)+"\n")
