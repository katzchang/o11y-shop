#!/usr/bin/env bash
# Start payment-svc, order-api and the load generator. Ctrl-C stops all of them.
set -euo pipefail
cd "$(dirname "$0")/.."

pids=()
cleanup() {
  echo "stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd payment-svc && go run .) &
pids+=($!)

(cd order-api && npm start) &
pids+=($!)

# wait for both services
for url in http://127.0.0.1:8081/healthz http://127.0.0.1:8080/healthz; do
  for _ in $(seq 1 60); do
    curl -fs "$url" >/dev/null 2>&1 && break
    sleep 0.5
  done
done

node loadgen/loadgen.js &
pids+=($!)

wait
