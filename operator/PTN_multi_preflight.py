#!/usr/bin/env python3
"""Read-only inventory for the PTN second-room release and ticket sale."""
import hashlib
import io
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
ROOT = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
FUNCTIONS = ('registrationRosterQueueV2', 'registrationQueueV2',
             'registrationQueueV2Worker', 'registrationQueueV2Sweep',
             'registrationDrawV2', 'registrationStartV2')
INSPECT_FUNCTIONS = {
    'commerceService': ('/service.cjs', '/ticket-purchase.cjs', '/domain.cjs'),
    'ladderAutoSettlement': ('/ladder-auto-settlement.js',
                            '/ladder-settlement-core.js'),
}
FILES = ('registration-flow-v2/backend/bindings.cjs',
         'registration-flow-v2/backend/lifecycle.cjs',
         'registration-flow-v2/backend/ticket-room-create.cjs',
         'registration-flow-v2/backend/ticket-host.cjs')
SETTINGS = ('commerceV1', 'commerceTicketCheckoutV1',
            'commerceDeliveryV1', 'commerceTicketPtnPilotV1',
            'commerceTicketLifecycleV1')


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


def ticket_products(token):
    cursor = ''
    for _ in range(4):
        query = '?pageSize=100'
        if cursor:
            query += '&pageToken=' + urllib.parse.quote(cursor, safe='')
        req = urllib.request.Request(ROOT + '/commerceProducts' + query,
                                     headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(req, timeout=20) as response:
            page = json.load(response)
        for row in page.get('documents', []):
            fields = row.get('fields', {})
            delivery = nested(fields, 'delivery')
            if value(delivery.get('kind')) != 'ticket':
                continue
            print(json.dumps({'ticketProduct': row['name'].rsplit('/', 1)[-1],
                'summary': summary(fields, ('name', 'status', 'priceTwd',
                                            'audience', 'version')),
                'delivery': summary(delivery, ('kind', 'assetId',
                                               'quantity', 'durationDays'))},
                ensure_ascii=False))
        cursor = page.get('nextPageToken', '')
        if not cursor:
            return
    raise RuntimeError('ticket-product-inventory-exceeds-read-limit')


def value(item):
    if not item:
        return None
    for key in ('booleanValue', 'integerValue', 'doubleValue', 'stringValue'):
        if key in item:
            return item[key]
    return None


def summary(fields, keys):
    return {key: value(fields.get(key)) for key in keys if key in fields}


def nested(fields, key):
    return fields.get(key, {}).get('mapValue', {}).get('fields', {})


def source_archive(function):
    info = json.loads(command('gcloud', 'functions', 'describe', function,
                              '--gen2', '--region=' + REGION,
                              '--project=' + PROJECT, '--format=json'))
    source = info['buildConfig']['source']['storageSource']
    archive = command('gcloud', 'storage', 'cat',
                      f'gs://{source["bucket"]}/{source["object"]}')
    return source['generation'], archive


def main():
    token = command('gcloud', 'auth', 'print-access-token').decode().strip()
    for function in FUNCTIONS:
        generation, archive = source_archive(function)
        with zipfile.ZipFile(io.BytesIO(archive)) as source_zip:
            hashes = {path.split('/')[-1]: hashlib.sha256(source_zip.read(path)).hexdigest()
                      for path in FILES if path in source_zip.namelist()}
        print(json.dumps({'function': function, 'generation': generation,
                          'hashes': hashes}, ensure_ascii=False))
    for function, suffixes in INSPECT_FUNCTIONS.items():
        generation, archive = source_archive(function)
        with zipfile.ZipFile(io.BytesIO(archive)) as source_zip:
            hashes = {path: hashlib.sha256(source_zip.read(path)).hexdigest()
                      for path in source_zip.namelist()
                      if path.endswith(suffixes)}
        print(json.dumps({'function': function, 'generation': generation,
                          'hashes': hashes}, ensure_ascii=False))
    settings = {}
    for name in SETTINGS:
        fields = firestore('systemSettings/' + name, token)
        settings[name] = fields
        output = summary(fields, ('enabled', 'bindingEnabled', 'version',
                                  'roomCode', 'latestRoomCode', 'storeOpen'))
        if name == 'commerceTicketPtnPilotV1':
            output['roomsCount'] = len(nested(fields, 'rooms'))
        if name == 'commerceV1':
            output['bankConfigured'] = bool(nested(fields, 'bank'))
            output['paymentHours'] = value(fields.get('paymentHours'))
        if name == 'commerceDeliveryV1':
            output['indexesReady'] = value(fields.get('indexesReady'))
            output['ticketCapability'] = value(nested(fields, 'deliveryCapabilities').get('ticket'))
            output['ticketConsumerRelease'] = value(nested(fields, 'consumerRelease').get('ticket'))
        output['fieldNames'] = sorted(fields)
        print(json.dumps({'setting': name, 'summary': output}, ensure_ascii=False))
    product_id = 'product_27acdfb3-8bba-4337-897c-1d9e8e29ce62'
    fields = firestore('commerceProducts/' + product_id, token)
    print(json.dumps({'product': product_id, 'summary': summary(fields,
          ('name', 'status', 'priceTwd', 'audience', 'version', 'purchasable')),
          'delivery': summary(nested(fields, 'delivery'),
                              ('kind', 'assetId', 'quantity', 'durationDays')),
          'fieldNames': sorted(fields)}, ensure_ascii=False))
    checkout = settings['commerceTicketCheckoutV1']
    ptn = settings['commerceTicketPtnPilotV1']
    print(json.dumps({'scopeChecks': {
        'checkoutOwnerMatchesPtnOwner': value(checkout.get('ownerUid')) == value(ptn.get('ownerUid')),
        'checkoutProductMatches32': value(checkout.get('productId')) == product_id,
        'ptnOwnerConfigured': bool(value(ptn.get('ownerUid'))),
        'ptnRoomConfigured': bool(value(ptn.get('roomId'))),
    }}, ensure_ascii=False))
    ticket_products(token)
    print('PTN_MULTI_READ_ONLY: no production changes')


if __name__ == '__main__':
    main()
