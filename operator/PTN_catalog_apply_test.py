import json
from pathlib import Path
import unittest
from unittest.mock import patch

from PTN_catalog_stage import field
import PTN_catalog_apply as candidate


class DraftApplyTest(unittest.TestCase):
    def test_atomic_writes_retain_live_32_and_keep_all_drafts(self):
        specs = json.loads(Path(__file__).with_name('PTN_sale_catalog.json').read_text())['products']
        first = specs[0]
        current = {'updateTime': '2026-11-23T00:00:00Z', 'fields': {
            'id': field(first['id']), 'status': field('draft'), 'version': field(1),
            'priceTwd': field(300), 'audience': field('partner_organizer'),
            'imageUrl': field('https://example.invalid/ticket.png'), 'sort': field(0),
            'createdAt': field(123),
            'delivery': {'mapValue': {'fields': {
                'kind': field('ticket'), 'assetId': field('32'),
                'quantity': field(1), 'durationDays': field(30)}}}}}
        def lookup(path, token):
            if path.endswith(first['id']):
                return current
            if path == 'systemSettings/commerceV1':
                return {'fields': {'enabled': field(False)}}
            return None
        with patch.object(candidate, 'read', side_effect=lookup):
            _, writes = candidate.prepare('token', 456)
        self.assertEqual(len(writes), 5)
        self.assertEqual(writes[0]['currentDocument'], {'updateTime': current['updateTime']})
        self.assertEqual(writes[0]['update']['name'],
                         'projects/bxh-arena/databases/(default)/documents/commerceProducts/' + first['id'])
        self.assertEqual(writes[0]['update']['fields']['createdAt'], field(123))
        self.assertTrue(all(w['currentDocument'] == {'exists': False} for w in writes[1:]))
        self.assertTrue(all(w['update']['fields']['status'] == field('draft') for w in writes))
        self.assertTrue(all(w['update']['fields']['delivery']['mapValue']['fields']['durationDays'] == field(0)
                            for w in writes))


if __name__ == '__main__':
    unittest.main()
