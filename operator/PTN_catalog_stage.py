#!/usr/bin/env python3
"""Prepare five PTN storefront products from the live 32-person draft; read only."""
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = 'bxh-arena'
ROOT = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
CATALOG = Path(__file__).with_name('PTN_sale_catalog.json')


def read(path, token):
    request = urllib.request.Request(ROOT + '/' + path,
                                     headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def scalar(item):
    for kind in ('stringValue', 'integerValue', 'booleanValue'):
        if kind in item:
            return item[kind]
    raise ValueError('unexpected product field')


def field(value):
    if isinstance(value, bool):
        return {'booleanValue': value}
    if isinstance(value, int):
        return {'integerValue': str(value)}
    if isinstance(value, str):
        return {'stringValue': value}
    raise ValueError('unexpected product value')


def stage(catalog, current, existing, sale, store):
    specs = catalog['products']
    if ([row['capacity'] for row in specs] != [32, 64, 96, 128, 160] or
            [row['priceTwd'] for row in specs] != [300, 600, 1000, 1500, 2000] or
            len({row['id'] for row in specs}) != 5 or catalog['delivery'] !=
            {'kind': 'ticket', 'quantity': 1, 'durationDays': 0}):
        raise ValueError('catalog changed')
    if not current or any(existing[spec['id']] for spec in specs[1:]) or sale:
        raise ValueError('live product or sale setting differs')
    base = current['fields']
    delivery = base['delivery']['mapValue']['fields']
    if (scalar(base['id']) != specs[0]['id'] or scalar(base['status']) != 'draft' or
            int(scalar(base['version'])) != 1 or int(scalar(base['priceTwd'])) != 300 or
            scalar(base['audience']) != 'partner_organizer' or
            {key: scalar(value) for key, value in delivery.items()} !=
            {'kind': 'ticket', 'assetId': '32', 'quantity': '1', 'durationDays': '30'} or
            not store or scalar(store['fields']['enabled']) is not False):
        raise ValueError('live 32-person draft or store changed')
    proposals = []
    for spec in specs:
        cap = spec['capacity']
        fields = {key: base[key] for key in ('imageUrl', 'sort')}
        fields.update({key: field(value) for key, value in {
            'id': spec['id'], 'name': f'賽事啟動券｜{cap} 人',
            'description': f'合作主辦積分賽啟動券，單場正取上限 {cap} 人。',
            'terms': catalog['terms'], 'priceTwd': spec['priceTwd'],
            'currency': 'TWD', 'audience': 'partner_organizer',
            'status': 'draft', 'version': 2 if cap == 32 else 1,
        }.items()})
        fields['sort'] = field(cap)
        fields['delivery'] = {'mapValue': {'fields': {
            key: field(str(cap) if key == 'assetId' else value)
            for key, value in {**catalog['delivery'], 'assetId': str(cap)}.items()}}}
        proposals.append({'id': spec['id'], 'fields': fields,
                          'precondition': {'updateTime': current['updateTime']}
                          if cap == 32 else {'exists': False}})
    return proposals


def main():
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    catalog = json.loads(CATALOG.read_text())
    specs = catalog['products']
    docs = {row['id']: read('commerceProducts/' + row['id'], token) for row in specs}
    sale = read('systemSettings/commerceTicketPtnSaleV1', token)
    store = read('systemSettings/commerceV1', token)
    proposals = stage(catalog, docs[specs[0]['id']], docs, sale, store)
    print(json.dumps({'status': 'PREPARED_ONLY', 'productionWrites': 0,
                      'products': [{'capacity': row['capacity'], 'priceTwd': row['priceTwd'],
                                    'id': row['id']} for row in specs],
                      'saleSettingEnabled': False, 'storeEnabled': False},
                     ensure_ascii=False))
    print('PTN_CATALOG_PREPARED: no production changes')


if __name__ == '__main__':
    main()
