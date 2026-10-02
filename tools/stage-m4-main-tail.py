#!/usr/bin/env python3
import argparse,hashlib,json,shutil
from pathlib import Path
BASE="99ab90be16347904f050c11ee7086cf11d367620"
MARK="/* P7.12.1: top-layer navigation avoids clipping inside fixed-height cards. */"
MOBILE='<link id="bxh-mobile-overrides-m3-1" rel="stylesheet" href="modules/mobile-overrides/styles.css?v=20261002-m3-1">'
LINK='<link id="bxh-main-tail-m4-1" rel="stylesheet" href="modules/main-css/tail-p7.css?v=20261002-m4-1">'
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def main(src,out):
 raw=(src/'index.html').read_bytes()
 if blob(raw)!=BASE:raise ValueError('production index baseline changed')
 t=raw.decode();p=t.find(MARK)
 if p<0:raise ValueError('M4 marker missing')
 a=t.rfind('<style',0,p);open_end=t.find('>',a)+1;z=t.find('</style>',p)
 if a<0 or open_end<=0 or z<0:raise ValueError('main style boundary missing')
 css=t[p:z]
 if len(css.encode())!=4239:raise ValueError('tail byte boundary changed')
 if 'url(' in css.lower():raise ValueError('relative url requires review')
 # Keep the remaining inline CSS in its original style; place external tail exactly after it.
 cand=(t[:p]+'</style>'+LINK+t[z+len('</style>'):]).encode()
 if cand.decode().find(LINK)>cand.decode().find(MOBILE):raise ValueError('cascade order changed: M4 link must precede M3 mobile overrides')
 shutil.copytree(src,out,ignore=shutil.ignore_patterns('.git','node_modules','__pycache__'))
 (out/'index.html').write_bytes(cand)
 q=out/'modules/main-css/tail-p7.css';q.parent.mkdir(parents=True,exist_ok=True);q.write_text(css,encoding='utf-8')
 m={'status':'STAGED_ONLY_NOT_DEPLOYED','source_index_blob':BASE,'candidate_index_blob':blob(cand),'source_index_bytes':len(raw),'candidate_index_bytes':len(cand),'css_bytes':len(css.encode()),'css_sha256':hashlib.sha256(css.encode()).hexdigest(),'stylesheet':'modules/main-css/tail-p7.css','relative_urls':0}
 (out/'m4-main-tail-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 print(json.dumps(m,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 try:main(a.source.resolve(),a.output.resolve())
 except (OSError,ValueError) as e:p.exit(1,'M4-1 BLOCKED: '+str(e)+'\n')
