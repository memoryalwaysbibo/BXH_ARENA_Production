#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ ! -e function-runtime ] || { echo 'unexpected previous function-runtime';exit 1; }
cp -R ../../referee-seats/functions function-runtime
cp function-tools/package-lock.json function-runtime/package-lock.json
(cd function-runtime && npm ci --ignore-scripts --no-audit --no-fund)
JAR="${RUNNER_TEMP:?}/firestore-emulator-v1.19.8.jar"
java -jar "$JAR" --host 127.0.0.1 --port 8080 --project_id demo-bxh-arena-e2e --rules ../e2e/firestore.rules > evidence/callable-firestore.log 2>&1 &
firestore=$!
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 ./emulator-tools/node_modules/.bin/firebase emulators:start --only auth,functions --project demo-bxh-arena-e2e --config callable-emulator.json > evidence/callable-runtime.log 2>&1 &
functions=$!
trap 'kill "$firestore" "$functions" 2>/dev/null || true;wait "$firestore" "$functions" 2>/dev/null || true' EXIT
ready=false
for i in $(seq 1 180);do
 if grep -q 'All emulators ready' evidence/callable-runtime.log && curl --silent --max-time 1 http://127.0.0.1:8080/ >/dev/null;then ready=true;break;fi
 if ! kill -0 "$firestore" || ! kill -0 "$functions";then cat evidence/callable-*.log;exit 1;fi
 sleep .5
done
[ "$ready" = true ] || { cat evidence/callable-*.log;exit 1; }
timeout 120s node callable-integration.mjs 2>&1 | tee evidence/callable-test.txt
