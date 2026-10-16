"""Regenerate exact handler fixtures from the verified production source export."""
import argparse
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
ENTRIES = {
    'lotteryRegistration': 'registration-selection.js',
    'manageRegistrationSelection': 'registration-selection.js',
    'manageEntrySelection': 'entry-selection.js',
    'familyRegistration': 'family-registration.js',
    'teamRegistration': 'team-registration-service.js',
    'registrationInvitations': 'registration-invitations.js',
    'courtCallService': 'court-call-service.js',
}


def build(source):
    source = pathlib.Path(source).resolve()
    pin = json.loads((ROOT / 'reference/backend-sources-20261016.json').read_text())
    services = {f['name']: f for f in pin['functions']}
    out = {'kind': 'EXACT_DEPLOYED_HANDLER_FIXTURES', 'files': {}, 'blobs': {}}

    def add(service, name):
        key = service + '/' + name
        if key in out['files']:
            return
        path = (source / key).resolve()
        if not path.is_relative_to(source / service):
            raise ValueError('Unsafe fixture dependency')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if services[service]['files'][name] != {'sha256': digest, 'bytes': len(raw)}:
            raise ValueError('Fixture source does not match production pin: ' + key)
        text = raw.decode()
        out['files'][key] = digest
        out['blobs'][digest] = text
        for dep in re.findall(r"require\(['\"](\.[^'\"]+)['\"]\)", text):
            target = (path.parent / dep).resolve()
            if not target.suffix:
                target = target.with_suffix('.js')
            add(service, str(target.relative_to(source / service)))

    for service, entry in ENTRIES.items():
        add(service, entry)
    return json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', required=True)
    args = parser.parse_args()
    (ROOT / 'reference/writer-handlers.json').write_text(build(args.sources))
