import json
from pathlib import Path
import unittest
from unittest.mock import patch

import PTN_sale_publish as publish
from PTN_catalog_stage import field


class SalePublishTest(unittest.TestCase):
    def test_publishes_five_repaired_drafts_and_creates_sale_setting_in_one_commit(self):
        specs = json.loads(Path(__file__).with_name('PTN_sale_catalog.json').read_text())['products']
        docs = {
            publish.STORE: {'fields': {'enabled': field(False), 'bank': {'mapValue': {}}}},
            publish.DELIVERY: {'fields': {
                'indexesReady': field(True),
                'deliveryCapabilities': {'mapValue': {'fields': {'ticket': field(True)}}},
                'consumerRelease': {'mapValue': {'fields': {'ticket': field('a' * 40)}}},
            }},
        }
        for spec in specs:
            docs['commerceProducts/' + spec['id']] = {
                'updateTime': '2026-11-23T00:00:00Z', 'fields': {
                    'id': field(spec['id']), 'status': field('draft'),
                    'version': field(3 if spec['capacity'] == 32 else 2),
                    'priceTwd': field(spec['priceTwd']), 'currency': field('TWD'),
                    'audience': field('partner_organizer'),
                    'imageUrl': field('https://example.invalid/ticket.png'),
                    'delivery': {'mapValue': {'fields': {
                        'kind': field('ticket'),
                        'assetId': field(str(spec['capacity'])),
                        'quantity': field(1), 'durationDays': field(0)}}},
                },
            }
        with (patch.object(publish, 'read', side_effect=lambda path, token: docs.get(path)),
              patch.object(publish, 'products', return_value=[])):
            _, writes = publish.prepare('token', 123)
            self.assertEqual(len(writes), 6)
            self.assertTrue(all(w['updateMask']['fieldPaths'] ==
                ['status', 'version', 'updatedAt', 'updatedBy'] for w in writes[:5]))
            self.assertEqual(writes[-1]['currentDocument'], {'exists': False})
            self.assertEqual(writes[-1]['update']['fields']['productIds']['mapValue']['fields'],
                {str(s['capacity']): field(s['id']) for s in specs})
            docs['commerceProducts/' + specs[0]['id']]['fields']['delivery']['mapValue']['fields']['assetId'] = field('64')
            with self.assertRaisesRegex(ValueError, 'draft changed'):
                publish.prepare('token', 123)


if __name__ == '__main__':
    unittest.main()
