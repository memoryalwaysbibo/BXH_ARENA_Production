#!/usr/bin/env python3
"""Repair missing capacity identifiers in five closed PTN product drafts."""
import argparse
import json
import subprocess
import time

from PTN_catalog_apply import RESOURCE, SALE, STORE, apply
from PTN_catalog_stage import CATALOG, field, read, scalar


def prepare(token, now):
    catalog = json.loads(CATALOG.read_text())
    specs = catalog['products']
    if ([s['capacity'] for s in specs] != [32, 64, 96, 128, 160] or
            [s['priceTwd'] for s in specs] != [300, 600, 1000, 1500, 2000]):
        raise ValueError('catalog changed')
    store, sale = read(STORE, token), read(SALE, token)
    if (not store or scalar(store['fields']['enabled']) is not False or
            sale is not None):
        raise ValueError('store or PTN sale changed')
    writes = []
    for spec in specs:
        doc = read('commerceProducts/' + spec['id'], token)
        if not doc:
            raise ValueError('draft missing: ' + spec['id'])
        fields = doc['fields']
        delivery = fields['delivery']['mapValue']['fields']
        expected_version = 2 if spec['capacity'] == 32 else 1
        if (scalar(fields['id']) != spec['id'] or
                scalar(fields['status']) != 'draft' or
                int(scalar(fields['version'])) != expected_version or
                int(scalar(fields['priceTwd'])) != spec['priceTwd'] or
                scalar(fields['audience']) != 'partner_organizer' or
                scalar(delivery['kind']) != 'ticket' or
                int(scalar(delivery['quantity'])) != 1 or
                int(scalar(delivery['durationDays'])) != 0 or
                'assetId' in delivery):
            raise ValueError('draft schema changed: ' + spec['id'])
        writes.append({
            'update': {
                'name': RESOURCE + '/commerceProducts/' + spec['id'],
                'fields': {
                    'delivery': {'mapValue': {'fields': {
                        'assetId': field(str(spec['capacity']))}}},
                    'version': field(expected_version + 1),
                    'updatedAt': field(now),
                    'updatedBy': field('operator:PTN_catalog_asset_repair'),
                },
            },
            'updateMask': {'fieldPaths': [
                'delivery.assetId', 'version', 'updatedAt', 'updatedBy']},
            'currentDocument': {'updateTime': doc['updateTime']},
        })
    return specs, writes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token'], text=True).strip()
    specs, writes = prepare(token, int(time.time() * 1000))
    print('PTN_ASSET_REPAIR_PREFLIGHT_OK', len(writes), 'drafts', flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    apply(token, writes)
    for spec in specs:
        doc = read('commerceProducts/' + spec['id'], token)
        fields = doc['fields']
        delivery = fields['delivery']['mapValue']['fields']
        if (scalar(fields['status']) != 'draft' or
                int(scalar(fields['version'])) != (3 if spec['capacity'] == 32 else 2) or
                scalar(delivery['assetId']) != str(spec['capacity']) or
                scalar(delivery['kind']) != 'ticket' or
                int(scalar(delivery['quantity'])) != 1 or
                int(scalar(delivery['durationDays'])) != 0):
            raise ValueError('post-write draft differs: ' + spec['id'])
    if read(SALE, token) is not None or scalar(read(STORE, token)['fields']['enabled']) is not False:
        raise ValueError('sale or store changed after repair')
    print('PTN_ASSET_REPAIR_DONE', len(writes), 'drafts; sale and store remain closed')


if __name__ == '__main__':
    main()
