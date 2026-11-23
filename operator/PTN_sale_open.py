#!/usr/bin/env python3
"""Open the global store only after PTN sale and live frontend checks pass."""
import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.request

from PTN_catalog_apply import RESOURCE, SALE, STORE, apply
from PTN_catalog_stage import CATALOG, field, read, scalar
from PTN_live_gate_preflight import GENERATIONS, products

FRONT = 'https://arena.bxh.com.tw/'
COMMERCE_UI_SHA256 = 'd1cd1007c935c570cf7e52d62d7a21d6a6ef3382c61fdfea72ba107395912a6d'


def hosted_frontend():
    req = urllib.request.Request(FRONT + '?ptnSalePreflight=' + str(int(time.time())),
                                 headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as response:
        html = response.read().decode('utf-8')
    if ('window.BXH_PTN_TICKET_SALE = true;' not in html or
            'commerce-ui.js?v=20261123-ptn-five-vouchers.1' not in html):
        raise ValueError('production page does not expose partner ticket entry')
    req = urllib.request.Request(
        FRONT + 'commerce-ui.js?v=20261123-ptn-five-vouchers.1',
        headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as response:
        script = response.read()
    if hashlib.sha256(script).hexdigest() != COMMERCE_UI_SHA256:
        raise ValueError('production commerce UI differs from validated source')


def prepare(token, now):
    hosted_frontend()
    for name in ('commerceService', 'ladderAutoSettlement',
                 'registrationRosterQueueV2', 'registrationDrawV2',
                 'registrationStartV2'):
        info = json.loads(subprocess.check_output([
            'gcloud', 'functions', 'describe', name, '--gen2',
            '--region=asia-east1', '--project=bxh-arena', '--format=json'
        ], text=True))
        if (info.get('state') != 'ACTIVE' or
                str(info['buildConfig']['source']['storageSource']['generation']) !=
                GENERATIONS[name]):
            raise ValueError(name + ': deployment changed')
    specs = json.loads(CATALOG.read_text())['products']
    ids = {str(row['capacity']): row['id'] for row in specs}
    if (list(map(lambda row: row['capacity'], specs)) != [32, 64, 96, 128, 160] or
            [row['priceTwd'] for row in specs] != [300, 600, 1000, 1500, 2000]):
        raise ValueError('catalog changed')
    store, sale = read(STORE, token), read(SALE, token)
    if (not store or scalar(store['fields']['enabled']) is not False or
            not sale or scalar(sale['fields']['enabled']) is not True or
            {cap: scalar(value) for cap, value in
             sale['fields']['productIds']['mapValue']['fields'].items()} != ids):
        raise ValueError('sale or store setting changed')
    bank = store['fields']['bank']['mapValue']['fields']
    if (not re.fullmatch(r'[0-9]{3}', str(scalar(bank['bankCode']))) or
            not re.fullmatch(r'[0-9 -]{5,30}', str(scalar(bank['accountNumber']))) or
            any(not str(scalar(bank[key])).strip()
                for key in ('bankName', 'branch', 'accountName')) or
            not 1 <= int(scalar(store['fields']['paymentHours'])) <= 168):
        raise ValueError('payment configuration changed')
    live = products(token)
    published = {doc['name'].rsplit('/', 1)[-1]: doc for doc in live
                 if scalar(doc['fields']['status']) == 'published'}
    if set(published) != set(ids.values()):
        raise ValueError('published catalog changed')
    for spec in specs:
        fields = published[spec['id']]['fields']
        delivery = fields['delivery']['mapValue']['fields']
        if (int(scalar(fields['priceTwd'])) != spec['priceTwd'] or
                int(scalar(fields['version'])) !=
                (4 if spec['capacity'] == 32 else 3) or
                scalar(fields['audience']) != 'partner_organizer' or
                scalar(delivery['kind']) != 'ticket' or
                scalar(delivery['assetId']) != str(spec['capacity']) or
                int(scalar(delivery['quantity'])) != 1 or
                int(scalar(delivery['durationDays'])) != 0):
            raise ValueError('published voucher changed: ' + spec['id'])
    current_version = int(scalar(store['fields']['version']))
    return [{
        'update': {
            'name': RESOURCE + '/' + STORE,
            'fields': {'enabled': field(True), 'version': field(current_version + 1),
                       'updatedAt': field(now),
                       'updatedBy': field('operator:PTN_sale_open')},
        },
        'updateMask': {'fieldPaths': ['enabled', 'version', 'updatedAt', 'updatedBy']},
        'currentDocument': {'updateTime': store['updateTime']},
    }]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token'], text=True).strip()
    writes = prepare(token, int(time.time() * 1000))
    print('PTN_SALE_OPEN_PREFLIGHT_OK 5 products; production frontend verified', flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    apply(token, writes)
    store = read(STORE, token)
    if scalar(store['fields']['enabled']) is not True:
        raise ValueError('post-write global storefront differs')
    print('PTN_SALE_OPENED 5 vouchers; checkout enabled')


if __name__ == '__main__':
    main()
