"""Build a standalone source tree for ONLY the two new public roster triggers."""
import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = args.output.resolve()
if out.exists():
    raise SystemExit('Refusing to overwrite an existing output directory')
files = ['public-registration-roster/functions/index.js',
         'public-registration-roster/functions/service.cjs',
         'qr-checkin/backend/overlays/registration-roster-core.js',
         'qr-checkin/backend/overlays/onsite-waitlist/owned.js']
for relative in files:
    destination = out / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / relative, destination)
(out / 'index.js').write_text("'use strict';\nrequire('firebase-admin/app').initializeApp();\nObject.assign(exports, require('./public-registration-roster/functions/index.js'));\n")
(out / 'package.json').write_text(json.dumps({
    'name': 'bxh-public-registration-roster', 'private': True, 'main': 'index.js',
    'engines': {'node': '22'},
    'dependencies': {'firebase-admin': '13.10.0', 'firebase-functions': '6.6.0'}
}, indent=2) + '\n')
print(json.dumps({'source': str(out), 'functions': ['syncPublicRegistrationRoster', 'refreshPublicRegistrationRoster']}))
