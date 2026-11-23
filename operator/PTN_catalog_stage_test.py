import json
from pathlib import Path
import unittest

from PTN_catalog_stage import field, stage


class CatalogStageTest(unittest.TestCase):
    def test_five_prices_are_prepared_as_drafts_without_expiry(self):
        catalog = json.loads(Path(__file__).with_name('PTN_sale_catalog.json').read_text())
        first = catalog['products'][0]
        base = {'fields': {
            'id': field(first['id']), 'status': field('draft'), 'version': field(1),
            'priceTwd': field(300), 'audience': field('partner_organizer'),
            'imageUrl': field('https://example.invalid/ticket.png'), 'sort': field(0),
            'delivery': {'mapValue': {'fields': {
                key: field(value) for key, value in {'kind': 'ticket', 'assetId': '32',
                    'quantity': 1, 'durationDays': 30}.items()}}}
        }, 'updateTime': '2026-11-23T00:00:00Z'}
        existing = {row['id']: base if row == first else None for row in catalog['products']}
        output = stage(catalog, base, existing, None, {'fields': {'enabled': field(False)}})
        self.assertEqual([int(row['fields']['priceTwd']['integerValue']) for row in output],
                         [300, 600, 1000, 1500, 2000])
        self.assertTrue(all(row['fields']['status']['stringValue'] == 'draft' for row in output))
        self.assertTrue(all(row['fields']['delivery']['mapValue']['fields']['durationDays'] ==
                            field(0) for row in output))
        self.assertEqual([row['fields']['delivery']['mapValue']['fields']['assetId']
                          for row in output], [field(str(cap)) for cap in (32, 64, 96, 128, 160)])
        self.assertEqual(output[0]['precondition'], {'updateTime': base['updateTime']})
        self.assertTrue(all(row['precondition'] == {'exists': False} for row in output[1:]))
        with self.assertRaisesRegex(ValueError, 'live product or sale setting differs'):
            stage(catalog, base, existing, {'fields': {'enabled': field(True)}},
                  {'fields': {'enabled': field(False)}})


if __name__ == '__main__':
    unittest.main()
