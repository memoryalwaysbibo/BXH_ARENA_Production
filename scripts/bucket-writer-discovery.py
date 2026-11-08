#!/usr/bin/env python3
"""Read-only discovery of BXH Functions, Cloud Run services and Cloud Run jobs.

Metadata discovery is not source review, IAM review or release acceptance.
No source archives, document data, environment values or credentials are saved.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

PROJECT = 'bxh-arena'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def cli(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Cloud Shell command unavailable or timed out') from None
    if result.returncode:
        raise RuntimeError('Read-only gcloud command failed')
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('API redirect refused')


def get_api(url, token):
    parts = urllib.parse.urlsplit(url)
    allowed = (
        parts.hostname == 'cloudfunctions.googleapis.com'
        and re.fullmatch(r'/v[12]/projects/bxh-arena/locations/-/functions', parts.path)
    ) or (
        parts.hostname == 'run.googleapis.com'
        and (re.fullmatch(r'/v2/projects/bxh-arena/locations/[a-z][a-z0-9-]+/(services|jobs)', parts.path)
             or parts.path == '/v1/projects/bxh-arena/locations')
    )
    if not allowed or parts.scheme != 'https' or parts.port is not None or parts.username or parts.password or parts.fragment:
        raise RuntimeError('Unexpected read API endpoint')
    if set(urllib.parse.parse_qs(parts.query)) - {'pageSize', 'pageToken'}:
        raise RuntimeError('Unexpected read API query')
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            raw = response.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise RuntimeError('Metadata response exceeds size budget')
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise RuntimeError('Invalid API response')
        return result
    except urllib.error.HTTPError as exc:
        raise RuntimeError('Read API HTTP ' + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise RuntimeError('Read API unavailable or invalid response') from None


def resource(name, kind, aliases):
    match = re.fullmatch(r'projects/([^/]+)/locations/([a-z][a-z0-9-]+)/' + kind + r'/([A-Za-z0-9_-]+)', name)
    if not match or match[1] not in aliases:
        raise RuntimeError('Unexpected resource identity')
    return f'projects/{PROJECT}/locations/{match[2]}/{kind}/{match[3]}', match[2]


def read_regions(token, read=get_api):
    regions, seen, page_hashes = set(), set(), []
    page = ''
    for _ in range(100):
        query = urllib.parse.urlencode({'pageSize': 100, **({'pageToken': page} if page else {})})
        data = read(f'https://run.googleapis.com/v1/projects/{PROJECT}/locations?{query}', token)
        if not isinstance(data.get('locations'), list) or data.get('unreachable'):
            raise RuntimeError('Cloud Run location discovery incomplete')
        page_hashes.append(digest(data))
        for row in data['locations']:
            name = row.get('locationId') or row.get('name', '').rsplit('/', 1)[-1]
            if not isinstance(name, str) or not re.fullmatch(r'[a-z][a-z0-9-]+', name) or name in regions:
                raise RuntimeError('Duplicate or invalid Cloud Run location')
            regions.add(name)
        next_page = data.get('nextPageToken', '')
        if not next_page:
            if not regions or len(regions) > 200:
                raise RuntimeError('Empty or excessive Cloud Run location discovery')
            return regions, digest(page_hashes)
        if not isinstance(next_page, str) or next_page in seen:
            raise RuntimeError('Repeated or invalid location page')
        seen.add(next_page)
        page = next_page
    raise RuntimeError('Location listing page budget exceeded')


def discover(token, project_number, regions, read=get_api):
    aliases = {PROJECT, project_number}
    report = {
        'stage': 'BUCKET_WRITER_METADATA_DISCOVERY', 'project': PROJECT,
        'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'productionWrites': 0, 'deploymentPerformed': False, 'roomActivationPerformed': False,
        'functions': [], 'services': [], 'jobs': [], 'regions': sorted(regions),
        'errors': [], 'unreachable': [], 'metadataDiscoveryComplete': False,
        'writerInventoryComplete': False, 'sourceReviewComplete': False, 'acceptanceCompleted': False,
        'uncoveredScopes': ['Admin/maintenance scripts outside discovered services and jobs',
                            'IAM permissions, impersonation and externally held Admin credentials',
                            'deployed source/dependency review and actual writer classification'],
    }

    def pages(base, field, consume, scope):
        seen = set()
        page = ''
        try:
            for _ in range(1000):
                query = urllib.parse.urlencode({'pageSize': 100, **({'pageToken': page} if page else {})})
                data = read(base + '?' + query, token)
                items = data.get(field, [])
                if not isinstance(items, list) or not isinstance(data.get('unreachable', []), list):
                    raise RuntimeError('Invalid listing response')
                if data.get('unreachable'):
                    # Do not save arbitrary server strings; any missing region blocks completeness.
                    report['unreachable'].append({'scope': scope, 'count': len(data['unreachable'])})
                for item in items:
                    if not isinstance(item, dict):
                        raise RuntimeError('Invalid resource metadata')
                    consume(item)
                next_page = data.get('nextPageToken', '')
                if not next_page:
                    return
                if not isinstance(next_page, str) or next_page in seen:
                    raise RuntimeError('Repeated or invalid listing page')
                seen.add(next_page)
                page = next_page
            raise RuntimeError('Listing page budget exceeded')
        except (RuntimeError, ValueError, TypeError):
            report['errors'].append({'scope': scope, 'reason': 'Listing incomplete; retry or check read permissions'})

    function_rows = {}
    function_services = {}

    def function(item, version):
        name, region = resource(item.get('name', ''), 'functions', aliases)
        row = function_rows.setdefault(name, {'name': name, 'region': region, 'apiViews': {}, 'writerClassification': 'unreviewed'})
        if version in row['apiViews']:
            raise RuntimeError('Duplicate Function identity in listing')
        build, service = item.get('buildConfig', {}), item.get('serviceConfig', {})
        view = {'metadataSha256': digest(item), 'updateTime': item.get('updateTime'),
                'state': item.get('state', item.get('status')), 'runtime': build.get('runtime', item.get('runtime')),
                'entryPoint': build.get('entryPoint', item.get('entryPoint')),
                'buildConfigSha256': digest(build), 'serviceConfigSha256': digest(service),
                'eventTriggerSha256': digest(item.get('eventTrigger'))}
        source = build.get('source', {}).get('storageSource', {})
        if source:
            view['sourceStorageSha256'] = digest(source)
        if service.get('service'):
            linked, _ = resource(service['service'], 'services', aliases)
            view['service'] = linked
            function_services.setdefault(linked, set()).add(name)
        row['apiViews'][version] = view

    for version in ['v1', 'v2']:
        pages(f'https://cloudfunctions.googleapis.com/{version}/projects/{PROJECT}/locations/-/functions',
              'functions', lambda item, v=version: function(item, v), 'functions-' + version)
    report['functions'] = sorted(function_rows.values(), key=lambda x: x['name'])

    for region in sorted(regions):
        for kind in ['services', 'jobs']:
            seen_resources = set()

            def run_item(item):
                name, actual_region = resource(item.get('name', ''), kind, aliases)
                if actual_region != region or name in seen_resources:
                    raise RuntimeError('Duplicate or wrong-region Cloud Run resource')
                seen_resources.add(name)
                row = {'name': name, 'region': region, 'uid': item.get('uid'),
                       'generation': item.get('generation'), 'updateTime': item.get('updateTime'),
                       'metadataSha256': digest(item), 'templateSha256': digest(item.get('template')),
                       'writerClassification': 'unreviewed'}
                if kind == 'services':
                    row['linkedFunctions'] = sorted(function_services.get(name, set()))
                    # A label or apparent Function association never exempts a service from review.
                    row['latestReadyRevision'] = item.get('latestReadyRevision')
                report[kind].append(row)

            pages(f'https://run.googleapis.com/v2/projects/{PROJECT}/locations/{region}/{kind}',
                  kind, run_item, f'run-{kind}:{region}')
    for kind in ['services', 'jobs']:
        report[kind].sort(key=lambda x: x['name'])
    listed_services = {x['name'] for x in report['services']}
    missing_services = sorted(set(function_services) - listed_services)
    if missing_services:
        report['errors'].append({'scope': 'function-service-links', 'reason': 'Linked Function services absent from Cloud Run discovery', 'resources': missing_services})
    discovered_regions = {x['region'] for x in report['functions']}
    if not discovered_regions.issubset(regions):
        report['errors'].append({'scope': 'regions', 'reason': 'Function region missing from Cloud Run region discovery'})
    report['completedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    report['metadataDiscoveryComplete'] = not report['errors'] and not report['unreachable'] and bool(regions)
    return report


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    os.umask(0o077)
    destination = Path(tempfile.mkdtemp(prefix='bxh-writer-discovery-', dir=Path.home()))
    try:
        if cli(['gcloud', 'config', 'get-value', 'project', '--quiet']) != PROJECT:
            raise RuntimeError('Active project must be bxh-arena')
        number = cli(['gcloud', 'projects', 'describe', PROJECT, '--format=value(projectNumber)', '--quiet'])
        if not re.fullmatch(r'[0-9]{6,20}', number):
            raise RuntimeError('Project number unavailable')
        token = cli(['gcloud', 'auth', 'print-access-token', '--quiet'])
        if not token:
            raise RuntimeError('No gcloud identity')
        regions, region_hash = read_regions(token)
        report = discover(token, number, regions)
        report['regionDiscoverySha256'] = region_hash
    except (RuntimeError, ValueError, TypeError, AttributeError):
        report = {'stage': 'BUCKET_WRITER_METADATA_DISCOVERY', 'productionWrites': 0,
                  'metadataDiscoveryComplete': False, 'writerInventoryComplete': False,
                  'acceptanceCompleted': False, 'errors': [{'scope': 'setup', 'reason': 'Read-only setup incomplete; check project, gcloud identity and read permissions'}]}
    report['toolSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    path = destination / 'report.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    path.chmod(0o600)
    archive = destination.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        output.write(path, 'report.json')
    archive.chmod(0o600)
    print(json.dumps({'reportFile': str(path), 'reviewZip': str(archive),
                      'metadataDiscoveryComplete': report['metadataDiscoveryComplete'],
                      'functionCount': len(report.get('functions', [])),
                      'serviceCount': len(report.get('services', [])), 'jobCount': len(report.get('jobs', [])),
                      'errorCount': len(report['errors']), 'productionWrites': 0,
                      'writerInventoryComplete': False, 'acceptanceCompleted': False}, ensure_ascii=False))
    if not report['metadataDiscoveryComplete']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
