#!/usr/bin/env python3
import argparse,hashlib,json,shutil
from pathlib import Path
BASE="ac4ae95673e4d96546f1fa9683fb3557de93164f"
MARK="/* v13.38.1: prevent mobile landing card CTA from being clipped */"
LINK='<link id="bxh-mobile-overrides-m3-1" rel="stylesheet" href="modules/mobile-overrides/styles.css?v=20261002-m3-1">'
def blob(b): return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def main(src,out):
 raw=(src/"index.html").read_bytes()
 if blob(raw)!=BASE: raise ValueError("main index baseline changed")
 t=raw.decode(); p=t.find(MARK)
 if p<0: raise ValueError("mobile marker missing")
 a=t.rfind("<style",0,p); a=t.find(">",a)+1; z=t.find("</style>",p)
 if a<=0 or z<0: raise ValueError("mobile style boundary missing")
 css=t[a:z]
 if MARK not in css: raise ValueError("marker escaped boundary")
 if "url(" in css.lower(): raise ValueError("relative url requires review")
 full_start=t.rfind("<style",0,p); full_end=z+len("</style>")
 cand=(t[:full_start]+LINK+t[full_end:]).encode()
 shutil.copytree(src,out,ignore=shutil.ignore_patterns(".git","node_modules","__pycache__"))
 q=out/"modules/mobile-overrides/styles.css";q.parent.mkdir(parents=True,exist_ok=True);q.write_text(css,encoding="utf-8")
 (out/"index.html").write_bytes(cand)
 m={"status":"STAGED_ONLY_NOT_DEPLOYED","source_index_blob":BASE,"candidate_index_blob":blob(cand),"source_index_bytes":len(raw),"candidate_index_bytes":len(cand),"css_bytes":len(css.encode()),"css_sha256":hashlib.sha256(css.encode()).hexdigest(),"stylesheet":"modules/mobile-overrides/styles.css","relative_urls":0}
 (out/"m3-mobile-overrides-manifest.json").write_text(json.dumps(m,indent=2)+"\n")
 print(json.dumps(m,indent=2))
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--source",type=Path,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
 try: main(a.source.resolve(),a.output.resolve())
 except (OSError,ValueError) as e:p.exit(1,"M3-1 BLOCKED: "+str(e)+"\n")
