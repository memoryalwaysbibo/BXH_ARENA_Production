#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
JAR="${RUNNER_TEMP:?}/firestore-emulator-v1.19.8.jar"
java -jar "$JAR" --host 127.0.0.1 --port 8080 --project_id demo-bxh-arena-e2e --rules ../e2e/firestore.rules > evidence/full-app-firestore.log 2>&1 &
firestore=$!
./emulator-tools/node_modules/.bin/firebase emulators:start --only auth --project demo-bxh-arena-e2e --config full-app-emulator.json > evidence/full-app-auth.log 2>&1 &
auth=$!
trap 'kill "$firestore" "$auth" 2>/dev/null || true;wait "$firestore" "$auth" 2>/dev/null || true' EXIT
ready=false
for i in $(seq 1 120);do
 if curl --silent --max-time 1 http://127.0.0.1:8080/ >/dev/null && curl --silent --max-time 1 http://127.0.0.1:9099/ >/dev/null;then ready=true;break;fi
 if ! kill -0 "$firestore" || ! kill -0 "$auth";then cat evidence/full-app-*.log;exit 1;fi
 sleep .5
done
[ "$ready" = true ] || { cat evidence/full-app-*.log;exit 1; }
node --test full-app-injection.test.cjs
./node_modules/.bin/esbuild full-app-entry.mjs --bundle --format=iife --platform=browser --outfile=full-app-bundle.js
timeout 240s node full-app-browser.mjs 2>&1 | tee evidence/full-app-browser.txt
