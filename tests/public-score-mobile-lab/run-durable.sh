#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node durable-publisher/prepare.cjs
node --test durable-publisher/publisher.test.cjs > evidence/durable-unit.txt
./node_modules/.bin/esbuild durable-entry.mjs --bundle --format=iife --platform=browser --outfile=full-app-bundle.js
java -jar "${RUNNER_TEMP:?}/firestore-emulator-v1.19.8.jar" --host 127.0.0.1 --port 8080 --project_id demo-bxh-arena-e2e --rules durable-publisher/runtime.rules > evidence/durable-firestore.txt 2>&1 & fire=$!
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 ./emulator-tools/node_modules/.bin/firebase emulators:start --only auth,functions --project demo-bxh-arena-e2e --config callable-emulator.json > evidence/durable-functions.txt 2>&1 & funcs=$!
worker='';trap 'kill $fire $funcs ${worker:-} 2>/dev/null || true;wait $fire $funcs ${worker:-} 2>/dev/null || true' EXIT
ready=false
for i in $(seq 1 180);do if grep -q 'All emulators ready' evidence/durable-functions.txt && curl -s --max-time 1 http://127.0.0.1:8080/ >/dev/null;then ready=true;break;fi;sleep .5;done
[ "$ready" = true ] || { tail -50 evidence/durable-functions.txt;exit 1; }
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node durable-publisher/worker.cjs > evidence/durable-worker.txt 2>&1 & worker=$!
timeout 240s node durable-browser.mjs 2>&1 | tee evidence/durable-browser.txt
