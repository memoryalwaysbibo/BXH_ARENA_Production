import json
from pathlib import Path
import unittest
from unittest.mock import patch

import PTN_sale_open as release
from PTN_catalog_stage import field


class SaleOpenTest(unittest.TestCase):
    def test_opens_only_when_five_offers_and_frontend_match(self):
        specs = json.loads(Path(__file__).with_name('PTN_sale_catalog.json').read_text())['products']
        store = {'updateTime': '2026-11-23T00:00:00Z', 'fields': {
            'enabled': field(False), 'version': field(3), 'paymentHours': field(48),
            'bank': {'mapValue': {'fields': {
                'bankCode': field('123'), 'accountNumber': field('12345'),
                'bankName': field('銀行'), 'branch': field('分行'),
                'accountName': field('BXH')}}}}}
        sale = {'fields': {'enabled': field(True),
            'productIds': {'mapValue': {'fields': {
                str(spec['capacity']): field(spec['id']) for spec in specs}}}}}
        offers = []
        for spec in specs:
            offers.append({
                'name': 'projects/bxh-arena/databases/(default)/documents/commerceProducts/' + spec['id'],
                'fields': {
                    'status': field('published'), 'priceTwd': field(spec['priceTwd']),
                    'version': field(4 if spec['capacity'] == 32 else 3),
                    'audience': field('partner_organizer'),
                    'delivery': {'mapValue': {'fields': {
                        'kind': field('ticket'), 'assetId': field(str(spec['capacity'])),
                        'quantity': field(1), 'durationDays': field(0)}}},
                }})
        def describe(args, text):
            name = args[3]
            return json.dumps({'state': 'ACTIVE', 'buildConfig': {'source': {
                'storageSource': {'generation': release.GENERATIONS[name]}}}})
        with (patch.object(release, 'hosted_frontend'),
              patch.object(release.subprocess, 'check_output', side_effect=describe),
              patch.object(release, 'read', side_effect=lambda path, token:
                           store if path == release.STORE else sale),
              patch.object(release, 'products', return_value=offers)):
            write = release.prepare('token', 123)[0]
            self.assertEqual(write['update']['fields']['enabled'], field(True))
            self.assertEqual(write['updateMask']['fieldPaths'],
                             ['enabled', 'version', 'updatedAt', 'updatedBy'])
            self.assertEqual(write['currentDocument'], {'updateTime': store['updateTime']})
            offers[0]['fields']['priceTwd'] = field(1)
            with self.assertRaisesRegex(ValueError, 'published voucher changed'):
                release.prepare('token', 123)


if __name__ == '__main__':
    unittest.main()
