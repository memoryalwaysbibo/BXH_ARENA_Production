import importlib.util
import contextlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('trigger_check', ROOT / 'scripts/bucket-trigger-order-readonly.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class TriggerOrder(unittest.TestCase):
    def trigger(self):
        return {'eventType': 'synthetic', 'triggerRegion': 'asia-east1', 'eventFilters': [
            {'attribute': 'database', 'value': '(default)'},
            {'attribute': 'document', 'value': 'tournaments/{code}/registrations/{id}', 'operator': 'match-path-pattern'}]}

    def test_filter_permutation_matches_every_other_field_exactly(self):
        a = self.trigger()
        b = {**a, 'eventFilters': list(reversed(a['eventFilters']))}
        expected = (M.digest(a), M.digest(b))
        self.assertNotEqual(*expected)
        self.assertTrue(all(M.compare_orders(b, expected).values()))

    def test_region_or_filter_value_changes_are_not_hidden(self):
        before = self.trigger()
        for after in [{**before, 'triggerRegion': 'us-central1'},
                      {**before, 'eventFilters': [{'attribute': 'database', 'value': 'other'}]}]:
            self.assertFalse(M.compare_orders(after, (M.digest(before),))[M.digest(before)])

    def test_both_observed_hashes_must_match(self):
        a = self.trigger()
        result = M.compare_orders(a, (M.digest(a), '0' * 64))
        self.assertTrue(result[M.digest(a)])
        self.assertFalse(all(result.values()))

    def test_unexpected_filter_shapes_stop(self):
        for value in [None, {}, {'eventFilters': []}, {'eventFilters': [None]}, {'eventFilters': [{}] * 9},
                      {'eventFilters': [{}], 'oversized': 'x' * 8193}]:
            with self.assertRaises(ValueError):
                M.compare_orders(value)

    def test_main_get_and_output_redaction(self):
        trigger = self.trigger()
        info = {'name': M.NAME, 'state': 'ACTIVE', 'eventTrigger': trigger,
                'buildConfig': {}, 'serviceConfig': {'environmentVariables': {'PRIVATE': 'DO_NOT_PRINT'}}}
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.full_url, 'https://cloudfunctions.googleapis.com/v2/' + M.NAME)
                self.assertEqual(request.get_method(), 'GET')
                self.assertIsNone(request.data)
                return io.BytesIO(json.dumps(info).encode())
        output = io.StringIO()
        old = M.digest(trigger)
        followup = M.digest({**trigger, 'eventFilters': list(reversed(trigger['eventFilters']))})
        with patch.object(M, 'cli', side_effect=[M.PROJECT, 'SYNTHETIC_TOKEN']), \
                patch.object(M.urllib.request, 'build_opener', return_value=Opener()), \
                patch.object(M, 'OLD', old), patch.object(M, 'FOLLOWUP', followup), \
                patch.object(M, 'BUILD', M.digest(info['buildConfig'])), \
                patch.object(M, 'SERVICE', M.digest(info['serviceConfig'])), \
                patch('sys.argv', ['bucket-trigger-order-readonly.py']), contextlib.redirect_stdout(output):
            M.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'FILTER_ORDER_ONLY')
        self.assertEqual(result['productionWrites'], 0)
        self.assertFalse(result['acceptanceCompleted'])
        self.assertNotIn('DO_NOT_PRINT', output.getvalue())
        self.assertNotIn('SYNTHETIC_TOKEN', output.getvalue())


if __name__ == '__main__':
    unittest.main()
