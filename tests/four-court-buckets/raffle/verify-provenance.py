"""Bind all three independent live source reads to the immutable captured fixture."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
report = json.loads((ROOT / 'release/buckets/raffle/live-provenance-20261107.json').read_text())
patches = json.loads((ROOT / 'release/buckets/operations/patch-manifest.json').read_text())['patches']
source = next(p for p in patches if p['sourceSet'] == 5)
assert report['project'] == 'bxh-arena' and report['stage'] == 'BUCKET_RAFFLE_SOURCES_READONLY'
assert report['captureComplete'] is True and report['errorCount'] == 0
assert report['productionWrites'] == 0 and report['deploymentPerformed'] is False
assert report['writerInventoryComplete'] is False and report['acceptanceCompleted'] is False
assert len(report['sources']) == 3
assert {s['name'] for s in report['sources']} == {'previewTournamentRaffle', 'drawTournamentRaffle', 'updateTournamentRaffleWinner'}
for row in report['sources']:
    assert row['stableDuringCapture'] is True
    assert row['sourceArchiveSha256'] == source['archiveSha256']
    for field in ['sourceArchiveSha256', 'metadataSha256', 'buildConfigSha256', 'serviceConfigSha256']:
        assert re.fullmatch('[0-9a-f]{64}', row[field]), field
evidence = report['evidence']
assert evidence['repository'] == 'memoryalwaysbibo/BXH_ARENA_Functions_Production'
assert evidence['runId'] == 42274492327 and evidence['artifactId'] == 13531248795
assert evidence['artifactSha256'] == '46c26965d4f861e545d98468e1822db84dc742c9aeb9bd5b2d5434a85f44961a'
assert evidence['baselineOperationsSha256'] == source['baselineFileSha256']
fixture = ROOT / 'tests/four-court-buckets/operations'
pins = json.loads((fixture / 'fixture-sha256.json').read_text())
for relative in ['fixtures/5/operations.js', 'fixtures/5/operations-core.js', 'fixtures/5/release-controls.js']:
    assert hashlib.sha256((fixture / relative).read_bytes()).hexdigest() == pins[relative]
assert hashlib.sha256((fixture / 'fixtures/5/operations.js').read_bytes()).hexdigest() == source['baselineFileSha256']
assert 'exports.previewTournamentRaffle=onCall' in (fixture / 'fixtures/5/operations.js').read_text()
print('PASS three independently captured live archives match sourceSet5; pinned fixture closure; no deployment or acceptance claim')
