#!/usr/bin/env python3
import argparse,hashlib,json,shutil
from pathlib import Path
BASE="32635b55c812f03bbd2f804bdec0b7114679042c"
MARK="/* Referee UX v2: fixed left / swap / right layout, including phones. */"
M4='<link id="bxh-main-tail-m4-1" rel="stylesheet" href="modules/main-css/tail-p7.css?v=20261002-m4-1">'
LINK='<link id="bxh-referee-tail-m5-1" rel="stylesheet" href="modules/main-css/referee-tail.css?v=20261002-m5-1">'
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def main(src,out):
 raw=(src/'index.html').read_bytes()
 if blob(raw)!=BASE:raise ValueError('production index baseline changed')
 t=raw.decode();p=t.find(MARK);z=t.find('</style>',p)
 if p<0 or z<0:raise ValueError('M5 boundary missing')
 css=t[p:z]
 if len(css.encode())!=9542:raise ValueError('M5 tail byte boundary changed')
 if 'url(' in css.lower():raise ValueError('relative url requires review')
 cand=(t[:p]+'</style>'+LINK+t[z+8:]).encode();h=cand.decode()
 if h.find(LINK)>h.find(M4):raise ValueError('cascade order changed: M5 must precede M4')
 shutil.copytree(src,out,ignore=shutil.ignore_patterns('.git','node_modules','__pycache__'))
 (out/'index.html').write_bytes(cand)
 q=out/'modules/main-css/referee-tail.css';q.parent.mkdir(parents=True,exist_ok=True);q.write_text(css,encoding='utf-8')
 m={'status':'STAGED_ONLY_NOT_DEPLOYED','source_index_blob':BASE,'candidate_index_blob':blob(cand),'source_index_bytes':len(raw),'candidate_index_bytes':len(cand),'css_bytes':len(css.encode()),'css_sha256':hashlib.sha256(css.encode()).hexdigest(),'stylesheet':'modules/main-css/referee-tail.css','relative_urls':0}
 (out/'m5-referee-tail-manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 try:main(a.source.resolve(),a.output.resolve())
 except (OSError,ValueError) as e:p.exit(1,'M5-1 BLOCKED: '+str(e)+'\n')
