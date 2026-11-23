#!/usr/bin/env python3
"""Read-only inventory for the PTN second-room release and ticket sale."""
import hashlib
import io
import json
import subprocess
import urllib.error
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
ROOT = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
FUNCTIONS = ('registrationRosterQueueV2', 'registrationQueueV2',
             'registrationQueueV2Worker', 'registrationQueueV2Sweep',
             'registrationDrawV2', 'registrationStartV2')
FILES = ('registration-flow-v2/backend/bindings.cjs',
         'registration-flow-v2/backend/lifecycle.cjs',
         'registration-flow-v2/backend/ticket-room-create.cjs',
         'registration-flow-v2/backend/ticket-host.cjs')
SETTINGS = ('commerceV1', 'commerceTicketCheckoutV1',
            'commerceDeliveryV1', 'commerceTicketPtnPilotV1')


def command(*args):
    return subprocess.check_output(args)


def firestore(path, token):
    req = urllib.request.Request(ROOT + '/' + path,
                                 headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response).get('fields', {})
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}
        raise


def value(item):
    if not item:
        return None
    for key in ('booleanValue', 'integerValue', 'doubleValue', 'stringValue'):
        if key in item:
            return item[key]
    return None


def summary(fields, keys):
    return {key: value(fields.get(key)) for key in keys if key in fields}


def main():
    token = command('gcloud', 'auth', 'print-access-token').decode().strip()
    for function in FUNCTIONS:
        info = json.loads(command('gcloud', 'functions', 'describe', function,
                                  '--gen2', '--region=' + REGION,
                                  '--project=' + PROJECT, '--format=json'))
        source = info['buildConfig']['source']['storageSource']
        archive = command('gcloud', 'storage', 'cat',
                          f'gs://{source["bucket"]}/{source["object"]}')
        with zipfile.ZipFile(io.BytesIO(archive)) as source_zip:
            hashes = {path.split('/')[-1]: hashlib.sha256(source_zip.read(path)).hexdigest()
                      for path in FILES if path in source_zip.namelist()}
        print(json.dumps({'function': function, 'generation': source['generation'],
                          'hashes': hashes}, ensure_ascii=False))
    for name in SETTINGS:
        fields = firestore('systemSettings/' + name, token)
        output = summary(fields, ('enabled', 'bindingEnabled', 'version',
                                  'roomCode', 'latestRoomCode', 'storeOpen'))
        if name == 'commerceTicketPtnPilotV1':
            output['roomsCount'] = len(fields.get('rooms', {}).get('mapValue', {}).get('fields', {}))
        output['fieldNames'] = sorted(fields)
        print(json.dumps({'setting': name, 'summary': output}, ensure_ascii=False))
    product_id = 'product_27acdfb3-8bba-4337-897c-1d9e8e29ce62'
    fields = firestore('commerceProducts/' + product_id, token)
    print(json.dumps({'product': product_id, 'summary': summary(fields,
          ('name', 'status', 'priceTwd', 'audience', 'version', 'purchasable')),
          'fieldNames': sorted(fields)}, ensure_ascii=False))
    print('PTN_MULTI_READ_ONLY: no production changes')


if __name__ == '__main__':
    main()
