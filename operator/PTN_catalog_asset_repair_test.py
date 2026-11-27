import json
from pathlib import Path
import unittest
from unittest.mock import patch

import PTN_catalog_asset_repair as repair
from PTN_catalog_stage import field


class AssetRepairTest(unittest.TestCase):
    def test_five_atomic_masked_updates_preserve_other_delivery_fields(self):
        specs = json.loads(Path(__file__).with_name('PTN_sale_catalog.json').read_text())['products']
        docs = {}
        for spec in specs:
            docs['commerceProducts/' + spec['id']] = {
                'updateTime': '2026-11-23T00:00:00Z',
                'fields': {
                    'id': field(spec['id']), 'status': field('draft'),
                    'version': field(2 if spec['capacity'] == 32 else 1),
                    'priceTwd': field(spec['priceTwd']),
                    'audience': field('partner_organizer'),
                    'delivery': {'mapValue': {'fields': {
                        'kind': field('ticket'), 'quantity': field(1),
                        'durationDays': field(0)}}},
                },
            }
        docs[repair.STORE] = {'fields': {'enabled': field(False)}}
        with patch.object(repair, 'read', side_effect=lambda path, token: docs.get(path)):
            _, writes = repair.prepare('token', 123)
            self.assertEqual(len(writes), 5)
            for spec, write in zip(specs, writes):
                self.assertEqual(write['updateMask']['fieldPaths'],
                                 ['delivery.assetId', 'version', 'updatedAt', 'updatedBy'])
                self.assertEqual(write['update']['fields']['delivery'],
                                 {'mapValue': {'fields': {'assetId': field(str(spec['capacity']))}}})
                self.assertEqual(write['currentDocument'],
                                 {'updateTime': '2026-11-23T00:00:00Z'})
            docs['commerceProducts/' + specs[0]['id']]['fields']['delivery']['mapValue']['fields']['assetId'] = field('32')
            with self.assertRaisesRegex(ValueError, 'draft schema changed'):
                repair.prepare('token', 123)


if __name__ == '__main__':
    unittest.main()
