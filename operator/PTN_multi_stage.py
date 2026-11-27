#!/usr/bin/env python3
"""Prepare PTN candidate sources from generation-pinned live ZIPs; never deploy."""
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
import stat

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FRONT = '68a8cec0d2ca2c1d3feb5c05257082c070fa1182'
COMMERCE = 'cab572fb6e3451b7893a8fdb1ada32eba11a95a3'
SETTLEMENT = 'a6c0bdf1e75b65926b1b5a5007f883d800ed9f9f'
BASE = 'registration-flow-v2/backend/'
ROOM_FILES = ('bindings.cjs', 'lifecycle.cjs', 'ticket-room-create.cjs', 'ticket-host.cjs')
TARGETS = {
    'registrationRosterQueueV2': ('1795421743641701',
      ('ec10fe166bfdf45ad6b58ac92db5c9367bd9e93ac123a7b20cea4c01b342a921',
       '5feee59bb69bd5c4766a0a53e3d553cccb92a558f48281bd51eeed71dfb44d8c',
       '368e3f87dfeb397a2d86832909f77d6f5b701482c2078682d870e314fefb9edc',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'registrationQueueV2': ('1795222746068144',
      ('684fab373f0b2df8b6e113ae9b3223a335fa895137fe8e24e89f6f8483ee3117',
       '1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f',
       '268082f4e9257f49e8f74e1ed2cd8e5ae15e2a69c8102f8030a07f300e5e0c8e',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'registrationQueueV2Worker': ('1795222676191962',
      ('afd5e66c9edf85dc1b215cbe5b15e2e3659553e9ddb9fcd911b6653b72451f77',
       '1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f',
       '268082f4e9257f49e8f74e1ed2cd8e5ae15e2a69c8102f8030a07f300e5e0c8e',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'registrationQueueV2Sweep': ('1795222675541485',
      ('afd5e66c9edf85dc1b215cbe5b15e2e3659553e9ddb9fcd911b6653b72451f77',
       '1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f',
       '268082f4e9257f49e8f74e1ed2cd8e5ae15e2a69c8102f8030a07f300e5e0c8e',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'registrationDrawV2': ('1795222815618372',
      ('684fab373f0b2df8b6e113ae9b3223a335fa895137fe8e24e89f6f8483ee3117',
       '1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f',
       '268082f4e9257f49e8f74e1ed2cd8e5ae15e2a69c8102f8030a07f300e5e0c8e',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'registrationStartV2': ('1795222816395885',
      ('684fab373f0b2df8b6e113ae9b3223a335fa895137fe8e24e89f6f8483ee3117',
       '1a157fa9e70c43c150bd8ab0118789043a0fba2517cadd03cb64e2b095a6f89f',
       '268082f4e9257f49e8f74e1ed2cd8e5ae15e2a69c8102f8030a07f300e5e0c8e',
       '38b1f578014d0516e59b1ee55e21848ab75b88806a7ac6d25e91c10f7e161a60')),
    'commerceService': ('1795109285115418',
      ('b6e61a61a4fd9e1563654d7a8b9698580afcfc584dae684481cb85700db3ffce',
       'e1bb7dddf7c09e24cb030db1dcd52e13c1833828d65af7813df8a5885f7079e2',
       'e8423393e5e32df1d7c92c1082fbd8dfdb47dd67cb506dda74bac5f39f819f1f')),
    'ladderAutoSettlement': ('1794722353569072',
      ('12b1b1237a04e7839e15458c783847597afb7a98d60c5f891a2fb7141e9f856b',
       '912694bf01c19f40f90e2cdb2a5ed28d8aecc617e1b3f7d577631cb810b3362f')),
}
FILES = {
    'room': tuple(BASE + p for p in ROOM_FILES),
    'commerce': ('domain.cjs', 'service.cjs', 'ticket-purchase.cjs'),
    'settlement': ('ladder-auto-settlement.js', 'ladder-settlement-core.js'),
}
REPLACEMENT = {
    'room': ('69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
             '9395d4c598a86852c03bc87a5f8e2d8da7f2b603b048d28f829f64b04934256e',
             '879d65551ac42f9b39f18247abd2cc1ee9cca1055f461f1c2528f341ff26f39d',
             '17245bd139e61250b2da74ca8474425b10b0988c815c5996737f61ed2f518a1a'),
    'commerce': ('91b11c26901c33bd9f45e7a9dbbc267f64838197f17fe26415b3d3de990b5b02',
                 '20c05d56971d6dd76a4cd38beb47d6eb7a64963bc7a9ebf9d3921425e747a432',
                 'c58930c1e0bd8bec1652cbcf700eaff5f1b9e5afb4e22b2e0c29bdef1363a553'),
    'settlement': ('37c104e3ff7ce29ed37a1748fa6b70904d71c69e95fa78b24ae085039375386d',
                   'f32ec50f5444812c8ec7658eeba2129b971d26ef0db0604b9cdee2c5f625cd1d'),
}
PROOF = ('ptn-settlement-proof.cjs',
         'd8356b409d40f9e8e176345d05aa9994ad8dea7d74e5bfd00ab291e525914870')

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def describe(name):
    info = json.loads(run('gcloud', 'functions', 'describe', name, '--gen2',
                          '--region=' + REGION, '--project=' + PROJECT, '--format=json'))
    source = info['buildConfig']['source']['storageSource']
    if info['buildConfig'].get('entryPoint') != name or not source.get('generation'):
        raise ValueError(name + ': function binding changed')
    return (source['bucket'], source['object'], str(source['generation']),
            info.get('labels', {}).get('firebase-functions-codebase'))

def checkout(root, repo, ref):
    root.mkdir()
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', '-C', str(root), 'fetch', '-q', '--depth=1',
                    'https://github.com/memoryalwaysbibo/' + repo + '.git', ref], check=True)
    subprocess.run(['git', '-C', str(root), 'checkout', '-q', '--detach', 'FETCH_HEAD'], check=True)
    if run('git', '-C', str(root), 'rev-parse', 'HEAD') != ref:
        raise ValueError('candidate commit changed')

def stage_one(root, name, binding, candidate, category):
    paths, hashes, expected = FILES[category], TARGETS[name][1], REPLACEMENT[category]
    source = root / name / 'functions'
    source.mkdir(parents=True)
    live_zip = root / name / 'live.zip'
    subprocess.run(['gcloud', 'storage', 'cp',
                    f'gs://{binding[0]}/{binding[1]}#{binding[2]}', str(live_zip), '--quiet'], check=True)
    with zipfile.ZipFile(live_zip) as archive:
        members = archive.infolist()
        if (len(members) != len({m.filename for m in members}) or len(members) > 10000 or
                sum(m.file_size for m in members) > 160_000_000):
            raise ValueError(name + ': unexpected ZIP members')
        for member in members:
            path = PurePosixPath(member.filename)
            kind = stat.S_IFMT(member.external_attr >> 16)
            if (path.is_absolute() or '..' in path.parts or '\\' in member.filename or
                    member.filename.rstrip('/') != path.as_posix().rstrip('/') or
                    kind not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError(name + ': unsafe ZIP member')
        for path, expected_hash in zip(paths, hashes):
            if path not in archive.namelist() or digest(archive.read(path)) != expected_hash:
                raise ValueError(name + ': live file differs: ' + path)
        if PROOF[0] in archive.namelist() and category == 'settlement':
            raise ValueError(name + ': proof module already deployed')
        archive.extractall(source)
    for path, expected_hash in zip(paths, expected):
        data = (candidate / path).read_bytes()
        if digest(data) != expected_hash:
            raise ValueError(name + ': candidate changed: ' + path)
        output = source / path
        output.write_bytes(data)
        subprocess.run(['node', '--check', str(output)], check=True)
    if category == 'settlement':
        data = (candidate / PROOF[0]).read_bytes()
        if digest(data) != PROOF[1]:
            raise ValueError('settlement proof changed')
        (source / PROOF[0]).write_bytes(data)
        subprocess.run(['node', '--check', str(source / PROOF[0])], check=True)
    package = json.loads((source / 'package.json').read_text())
    if package.get('engines', {}).get('node') != '22':
        raise ValueError(name + ': unexpected Node runtime')
    return {'function': name, 'generation': binding[2], 'codebase': binding[3],
            'sourceSha256': digest(live_zip.read_bytes()), 'replaced': list(paths),
            'added': [PROOF[0]] if category == 'settlement' else []}

def candidate_path(checkouts, category):
    if category == 'room':
        return checkouts / 'front'
    if category == 'commerce':
        return checkouts / 'commerce' / 'release/commerce/functions'
    if category == 'settlement':
        return checkouts / 'settlement' / 'release/bucket-settlement-package/auto'
    raise ValueError('unexpected candidate category')

def main():
    out = Path(tempfile.mkdtemp(prefix='bxh-ptn-stage-'))
    checkouts = out / 'candidates'
    checkouts.mkdir()
    checkout(checkouts / 'front', 'BXH_ARENA_Production', FRONT)
    checkout(checkouts / 'commerce', 'BXH_ARENA_Functions_Production', COMMERCE)
    checkout(checkouts / 'settlement', 'BXH_ARENA_Functions_Production', SETTLEMENT)
    report = []
    for name, (generation, _) in TARGETS.items():
        binding = describe(name)
        if binding[2] != generation or (not binding[3] and name != 'ladderAutoSettlement'):
            raise ValueError(name + ': live generation or codebase changed')
        category = ('room' if name.startswith('registration') else
                    'commerce' if name in ('commerceService', 'commerceDelivery') else 'settlement')
        report.append(stage_one(out, name, binding, candidate_path(checkouts, category), category))
        if describe(name) != binding:
            raise ValueError(name + ': source changed during staging')
    (out / 'report.json').write_text(json.dumps({'status': 'STAGED_ONLY',
        'productionWrites': 0, 'candidateCommits': [FRONT, COMMERCE, SETTLEMENT],
        'functions': report}, indent=2) + '\n')
    print('PTN_STAGE_OK', out)
    print(json.dumps({'status': 'STAGED_ONLY', 'productionWrites': 0,
                      'functions': [{'name': x['function'], 'generation': x['generation'],
                                     'codebase': x['codebase']} for x in report]}))

if __name__ == '__main__':
    main()
