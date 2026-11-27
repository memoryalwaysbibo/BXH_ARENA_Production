#!/usr/bin/env python3
"""Read-only check of PTN functions, draft products and global storefront scope."""
import json
import subprocess
import urllib.parse
import urllib.request

from PTN_catalog_stage import CATALOG, ROOT, read, scalar

GENERATIONS = {
    'registrationRosterQueueV2': '1795446793775383',
    'registrationQueueV2': '1795447309724820',
    'registrationQueueV2Worker': '1795448124990567',
    'registrationQueueV2Sweep': '1795449304849710',
    'registrationDrawV2': '1795453463375594',
    'registrationStartV2': '1795453694543142',
    'commerceService': '1795446258132937',
    'ladderAutoSettlement': '1795445686530313',
}


def products(token):
    result, page = [], None
    while True:
        params = {'pageSize': '100'}
        if page:
            params['pageToken'] = page
        req = urllib.request.Request(ROOT + '/commerceProducts?' +
            urllib.parse.urlencode(params),
            headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.load(response)
        result.extend(data.get('documents', []))
        page = data.get('nextPageToken')
        if not page:
            return result


def main():
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token'], text=True).strip()
    catalog = json.loads(CATALOG.read_text())
    expected = {row['id']: row for row in catalog['products']}
    functions = {}
    for name, generation in GENERATIONS.items():
        info = json.loads(subprocess.check_output([
            'gcloud', 'functions', 'describe', name, '--gen2',
            '--region=asia-east1', '--project=bxh-arena', '--format=json'
        ], text=True))
        source = info['buildConfig']['source']['storageSource']
        found = str(source['generation'])
        if found != generation or info.get('state') != 'ACTIVE':
            raise ValueError(name + ': generation or state changed')
        functions[name] = found
    store = read('systemSettings/commerceV1', token)
    sale = read('systemSettings/commerceTicketPtnSaleV1', token)
    delivery = read('systemSettings/commerceDeliveryV1', token)
    if not store or scalar(store['fields']['enabled']) is not False or sale is not None:
        raise ValueError('sale or global storefront already changed')
    release = delivery['fields']
    if (scalar(release['indexesReady']) is not True or
            scalar(release['deliveryCapabilities']['mapValue']['fields']['ticket']) is not True or
            len(scalar(release['consumerRelease']['mapValue']['fields']['ticket'])) != 40 or
            'bank' not in store['fields']):
        raise ValueError('payment or ticket delivery not ready')
    inventory = products(token)
    drafts, others = [], []
    for document in inventory:
        fields = document['fields']
        product_id = document['name'].rsplit('/', 1)[-1]
        status = scalar(fields['status'])
        if product_id in expected:
            spec = expected[product_id]
            delivery_fields = fields['delivery']['mapValue']['fields']
            if (status != 'draft' or
                    int(scalar(fields['priceTwd'])) != spec['priceTwd'] or
                    scalar(fields['audience']) != 'partner_organizer' or
                    scalar(delivery_fields['assetId']) != str(spec['capacity']) or
                    int(scalar(delivery_fields['quantity'])) != 1 or
                    int(scalar(delivery_fields['durationDays'])) != 0):
                raise ValueError('PTN draft changed: ' + product_id)
            drafts.append(product_id)
        elif status == 'published':
            others.append({'id': product_id, 'name': scalar(fields['name'])})
    if set(drafts) != set(expected):
        raise ValueError('PTN draft count changed')
    print('PTN_LIVE_GATE_OK', json.dumps({
        'functions': functions, 'ptnDrafts': len(drafts),
        'storeEnabled': False, 'saleSettingExists': False,
        'otherPublishedProducts': others, 'productionWrites': 0
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
