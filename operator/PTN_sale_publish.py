#!/usr/bin/env python3
"""Publish five repaired PTN vouchers while keeping global checkout closed."""
import argparse
import json
import re
import subprocess
import time

from PTN_catalog_apply import RESOURCE, SALE, STORE, apply
from PTN_catalog_stage import CATALOG, field, read, scalar
from PTN_live_gate_preflight import products

DELIVERY = 'systemSettings/commerceDeliveryV1'


def mapping(specs):
    return {str(spec['capacity']): spec['id'] for spec in specs}


def prepare(token, now):
    catalog = json.loads(CATALOG.read_text())
    specs = catalog['products']
    if ([s['capacity'] for s in specs] != [32, 64, 96, 128, 160] or
            [s['priceTwd'] for s in specs] != [300, 600, 1000, 1500, 2000] or
            len({s['id'] for s in specs}) != 5):
        raise ValueError('catalog changed')
    store, sale, delivery = read(STORE, token), read(SALE, token), read(DELIVERY, token)
    if (not store or scalar(store['fields']['enabled']) is not False or
            'bank' not in store['fields'] or sale is not None or not delivery):
        raise ValueError('store, sale or payment changed')
    release = delivery['fields']
    if (scalar(release['indexesReady']) is not True or
            scalar(release['deliveryCapabilities']['mapValue']['fields']['ticket']) is not True or
            not re.fullmatch('[a-f0-9]{40}',
                str(scalar(release['consumerRelease']['mapValue']['fields']['ticket'])))):
        raise ValueError('ticket delivery changed')
    published = [doc['name'].rsplit('/', 1)[-1] for doc in products(token)
                 if scalar(doc['fields']['status']) == 'published']
    if published:
        raise ValueError('other published products appeared: ' + ','.join(published))
    writes = []
    for spec in specs:
        doc = read('commerceProducts/' + spec['id'], token)
        if not doc:
            raise ValueError('draft missing: ' + spec['id'])
        fields = doc['fields']
        d = fields['delivery']['mapValue']['fields']
        version = 3 if spec['capacity'] == 32 else 2
        if (scalar(fields['id']) != spec['id'] or
                scalar(fields['status']) != 'draft' or
                int(scalar(fields['version'])) != version or
                int(scalar(fields['priceTwd'])) != spec['priceTwd'] or
                scalar(fields['audience']) != 'partner_organizer' or
                scalar(fields['currency']) != 'TWD' or
                not str(scalar(fields['imageUrl'])).startswith('https://') or
                scalar(d['kind']) != 'ticket' or
                scalar(d['assetId']) != str(spec['capacity']) or
                int(scalar(d['quantity'])) != 1 or
                int(scalar(d['durationDays'])) != 0):
            raise ValueError('draft changed: ' + spec['id'])
        writes.append({
            'update': {
                'name': RESOURCE + '/commerceProducts/' + spec['id'],
                'fields': {'status': field('published'), 'version': field(version + 1),
                           'updatedAt': field(now),
                           'updatedBy': field('operator:PTN_sale_publish')},
            },
            'updateMask': {'fieldPaths': ['status', 'version', 'updatedAt', 'updatedBy']},
            'currentDocument': {'updateTime': doc['updateTime']},
        })
    writes.append({
        'update': {
            'name': RESOURCE + '/' + SALE,
            'fields': {
                'enabled': field(True), 'version': field(1),
                'productIds': {'mapValue': {'fields': {
                    cap: field(product_id) for cap, product_id in mapping(specs).items()}}},
                'updatedAt': field(now),
                'updatedBy': field('operator:PTN_sale_publish'),
            },
        },
        'currentDocument': {'exists': False},
    })
    return specs, writes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token'], text=True).strip()
    specs, writes = prepare(token, int(time.time() * 1000))
    print('PTN_SALE_PUBLISH_PREFLIGHT_OK', len(specs), 'products; store closed', flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    apply(token, writes)
    sale = read(SALE, token)
    ids = sale['fields']['productIds']['mapValue']['fields']
    if (scalar(sale['fields']['enabled']) is not True or
            {cap: scalar(value) for cap, value in ids.items()} != mapping(specs)):
        raise ValueError('post-write sale setting differs')
    for spec in specs:
        fields = read('commerceProducts/' + spec['id'], token)['fields']
        if (scalar(fields['status']) != 'published' or
                scalar(fields['delivery']['mapValue']['fields']['assetId']) !=
                str(spec['capacity'])):
            raise ValueError('post-write product differs: ' + spec['id'])
    if scalar(read(STORE, token)['fields']['enabled']) is not False:
        raise ValueError('global storefront changed; inspect before continuing')
    print('PTN_SALE_PUBLISHED', len(specs), 'products; global checkout remains closed')


if __name__ == '__main__':
    main()
