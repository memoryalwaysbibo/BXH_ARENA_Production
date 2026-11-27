#!/usr/bin/env python3
"""Atomically stage five PTN product drafts; never open checkout or publish."""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request

from PTN_catalog_stage import CATALOG, ROOT, field, read, scalar, stage

COMMIT = ROOT + ':commit'
RESOURCE = ROOT.removeprefix('https://firestore.googleapis.com/v1/')
SALE = 'systemSettings/commerceTicketPtnSaleV1'
STORE = 'systemSettings/commerceV1'


def prepare(token, now):
    catalog = json.loads(CATALOG.read_text())
    specs = catalog['products']
    docs = {row['id']: read('commerceProducts/' + row['id'], token) for row in specs}
    proposals = stage(catalog, docs[specs[0]['id']], docs,
                      read(SALE, token), read(STORE, token))
    writes = []
    for index, proposal in enumerate(proposals):
        fields = proposal['fields']
        if index == 0:
            fields['createdAt'] = docs[proposal['id']]['fields']['createdAt']
        else:
            fields['createdAt'] = field(now)
        fields['updatedAt'] = field(now)
        fields['updatedBy'] = field('operator:PTN_catalog_apply')
        writes.append({'update': {'name': RESOURCE + '/commerceProducts/' + proposal['id'],
                                  'fields': fields},
                       'currentDocument': proposal['precondition']})
    return specs, writes


def apply(token, writes):
    request = urllib.request.Request(
        COMMIT, data=json.dumps({'writes': writes}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token,
                 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError('Firestore commit rejected: ' +
                         error.read().decode('utf-8', errors='replace')[:1200]) from error
    if len(result.get('writeResults', [])) != len(writes):
        raise ValueError('unexpected write count; inspect products before retry')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-drafts', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    specs, writes = prepare(token, int(time.time() * 1000))
    if not args.apply_drafts:
        print('PTN_DRAFT_PREFLIGHT_OK', json.dumps({
            'writes': len(writes), 'status': 'draft', 'saleEnabled': False,
            'storeEnabled': False, 'productionWrites': 0,
            'products': [{'capacity': s['capacity'], 'priceTwd': s['priceTwd']}
                         for s in specs]}, ensure_ascii=False))
        return
    apply(token, writes)
    for spec in specs:
        doc = read('commerceProducts/' + spec['id'], token)
        fields = doc['fields']
        if (scalar(fields['status']) != 'draft' or
                int(scalar(fields['priceTwd'])) != spec['priceTwd'] or
                scalar(fields['delivery']['mapValue']['fields']['durationDays']) != '0'):
            raise ValueError('post-write product differs: ' + spec['id'])
    if read(SALE, token) is not None or scalar(read(STORE, token)['fields']['enabled']) is not False:
        raise ValueError('sale/store setting changed; inspect before continuing')
    print('PTN_DRAFTS_STAGED', len(writes), 'products; sale and store remain closed')


if __name__ == '__main__':
    main()
