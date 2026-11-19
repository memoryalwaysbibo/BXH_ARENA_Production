#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p evidence
JAR="${RUNNER_TEMP:?RUNNER_TEMP is required}/firestore-emulator-v1.19.8.jar"
curl --fail --location --retry 2 --max-time 120 'https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar' -o "$JAR"
printf '%s  %s\n' '9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d' "$JAR" | sha256sum -c -
java -jar "$JAR" --host 127.0.0.1 --port 18786 --project_id demo-arena-public-delta --rules firestore.rules > evidence/emulator.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
ready=false
for i in $(seq 1 100); do
 if curl --silent --max-time 1 http://127.0.0.1:18786/ >/dev/null; then ready=true;break;fi
 if ! kill -0 "$pid" 2>/dev/null;then cat evidence/emulator.log;exit 1;fi
 sleep .2
done
if [ "$ready" != true ]; then echo 'emulator readiness timeout';exit 1;fi
node --test schema.test.cjs browser-lifecycle.test.mjs engine.test.cjs | tee evidence/unit.txt
timeout 60s node integration.mjs 2>&1 | tee evidence/sdk.txt
timeout 60s node spectator.test.mjs 2>&1 | tee evidence/spectator.txt
./node_modules/.bin/esbuild mobile-entry.mjs --bundle --format=esm --platform=browser --outfile=mobile-bundle.js
timeout 120s node mobile-qualification.mjs 2>&1 | tee evidence/mobile.txt
cp mobile-*.png evidence/ 2>/dev/null || true

node build-renderers.cjs
./node_modules/.bin/esbuild engine-entry.mjs --bundle --format=esm --platform=browser --outfile=engine-bundle.js
timeout 120s node engine-browser.mjs 2>&1 | tee evidence/engine-browser.txt

bash run-full-app.sh
