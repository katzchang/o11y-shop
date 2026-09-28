#!/usr/bin/env bash
# Change the mock payment gateway latency. Usage: scripts/slow-gateway.sh 1500
set -euo pipefail
curl -fsS -X POST "http://127.0.0.1:8081/admin/gateway-latency?ms=${1:-200}"
