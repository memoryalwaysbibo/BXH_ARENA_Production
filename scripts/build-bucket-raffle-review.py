"""Assemble a local review archive from the pinned, privately supplied source transfer."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TRANSFER_SHA256 = 'a522732a34466104ae403688c26eee18dc36116ac5afb08df750dd97678be28e'
ENTRYPOINTS = ('previewTournamentRaffle', 'drawTournamentRaffle', 'updateTournamentRaffleWinner')
CLOSURE = (
    'raffle/context.cjs', 'raffle/identity.cjs', 'raffle/input.cjs',
    'raffle/preview.cjs', 'raffle/writers.cjs',
    'completion/certificate.cjs', 'completion/protocol/state.cjs',
)
CALL_OPTIONS = "{region,cors:true,invoker:'public'}"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_spec():
    manifest = json.loads((ROOT / 'release/buckets/operations/patch-manifest.json').read_text())
    return next(row for row in manifest['patches'] if row['sourceSet'] == 5)


def patch_operations(original):
    if sha(original) != source_spec()['baselineFileSha256']:
        raise ValueError('operations.js baseline hash mismatch')
    text = original.decode('utf-8')
    signatures = [f'exports.{name}=onCall({CALL_OPTIONS},' for name in ENTRYPOINTS]
    if any(text.count(signature) != 1 for signature in signatures):
        raise ValueError('raffle export signature mismatch')
    start = text.index(signatures[0])
    exports = [line.split('=', 1)[0][8:] for line in text[start:].splitlines() if line.startswith('exports.')]
    if exports != list(ENTRYPOINTS):
        raise ValueError('unexpected exports after raffle block')
    bindings = (
        "const {createRafflePreview}=require('./bucket-raffle/raffle/preview.cjs');\n"
        "const {createRaffleWriters}=require('./bucket-raffle/raffle/writers.cjs');\n"
        "const raffleOptions={db,core:C,HttpsError};\n"
        "const raffleWriters=createRaffleWriters(raffleOptions);\n"
        f"{signatures[0]}createRafflePreview(raffleOptions));\n"
        f"{signatures[1]}raffleWriters.draw);\n"
        f"{signatures[2]}raffleWriters.update);\n"
    )
    return (text[:start] + bindings).encode('utf-8')


def assemble(baseline):
    result = dict(baseline)
    result['operations.js'] = patch_operations(baseline['operations.js'])
    for path in CLOSURE:
        member = 'bucket-raffle/' + path
        if member in result:
            raise ValueError('candidate dependency collides with original member')
        result[member] = (ROOT / 'release/buckets' / path).read_bytes()
    return result


def read_transfer(path):
    raw = path.read_bytes()
    if sha(raw) != TRANSFER_SHA256:
        raise ValueError('source transfer does not match reviewed input')
    transfer = json.loads(raw)
    manifest = transfer['source_set_manifest']
    archive = source_spec()['archiveSha256']
    provenance = json.loads((ROOT / 'release/buckets/raffle/live-provenance-20261107.json').read_text())
    if (transfer['schema'] != 'verified-offline-source-transfer-v1' or
            manifest['id'] != 5 or manifest['archiveSha256'] != archive or
            {row['name'] for row in provenance['sources']} != set(ENTRYPOINTS) or
            any(row['sourceArchiveSha256'] != archive for row in provenance['sources'])):
        raise ValueError('source provenance mismatch')
    members = {row['path']: (row['sha256'], row['size']) for row in manifest['files']}
    files = {}
    for row in transfer['files']:
        name = row['path']
        relative = PurePosixPath(name)
        if relative.is_absolute() or str(relative) != name or '..' in relative.parts or '\\' in name or name in files:
            raise ValueError('invalid or duplicate archive member')
        data = ''.join(row['content_lines']).encode('utf-8')
        if (sha(data), len(data)) != members.get(name) or (row['sha256'], row['bytes']) != members[name]:
            raise ValueError('source member hash or length mismatch')
        files[name] = data
    if len(files) != 107 or files.keys() != members.keys():
        raise ValueError('incomplete reviewed source closure')
    if b'Object.assign(exports, require("./operations"));' not in files['index.js']:
        raise ValueError('expected normal entrypoint forwarding is absent')
    return files


def fixture_tree(output):
    """Stage the public fixture closure for isolated entrypoint tests."""
    fixture = ROOT / 'tests/four-court-buckets/operations/fixtures/5'
    files = {name: (fixture / name).read_bytes() for name in ('operations.js', 'operations-core.js', 'release-controls.js')}
    output.mkdir(parents=True, exist_ok=False)
    for name, data in assemble(files).items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def build(transfer, output):
    original = read_transfer(transfer)
    files = assemble(original)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    archive = output / 'raffle-source-review.zip'
    with zipfile.ZipFile(archive, 'x') as package:
        for name in sorted(files):
            entry = zipfile.ZipInfo(name)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            package.writestr(entry, files[name])
    archive.chmod(0o600)
    with zipfile.ZipFile(archive) as package:
        if package.namelist() != sorted(files) or any(package.read(name) != data for name, data in files.items()):
            raise ValueError('assembled ZIP verification failed')
    report = {'status': 'review-only', 'entrypoints': list(ENTRYPOINTS),
              'baselineArchiveSha256': source_spec()['archiveSha256'],
              'sourceTransferSha256': TRANSFER_SHA256, 'candidateZipSha256': sha(archive.read_bytes()),
              'candidateFileCount': len(files), 'preservedFiles': len(original) - 1,
              'replacedFiles': ['operations.js'], 'addedFiles': ['bucket-raffle/' + name for name in CLOSURE],
              'productionWrites': 0, 'deploymentPerformed': False}
    (output / 'review.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--source-transfer', type=Path)
    inputs.add_argument('--fixture-tree', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.fixture_tree:
        fixture_tree(args.output)
    else:
        print(json.dumps(build(args.source_transfer, args.output)))
