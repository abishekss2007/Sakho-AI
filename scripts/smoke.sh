#!/usr/bin/env bash
# Container smoke test used by CI and the deploy workflow.
# Usage: scripts/smoke.sh <image-reference>
# Runs the image with mock providers (no credentials), then checks liveness,
# the page, the demo-mode contract and one real API round trip.
set -euo pipefail

IMAGE="${1:?image reference required}"
NAME="sakho-smoke-$$"
PORT="${SMOKE_PORT:-18080}"

cleanup() {
  docker logs "$NAME" 2>&1 | tail -n 40 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# PORT is set the way Cloud Run sets it, to prove the server honours it.
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:9090" \
  -e PORT=9090 -e SAKHO_MOCK_PROVIDERS=true "$IMAGE" >/dev/null

BASE="http://127.0.0.1:${PORT}"
for attempt in $(seq 1 30); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 30 ]; then echo "Container did not become healthy" >&2; exit 1; fi
  sleep 1
done

HEALTH="$(curl -fsS "$BASE/api/health")"
echo "health: $HEALTH"
echo "$HEALTH" | grep -q '"service":"sakho-ai"'
# With no SOS_MODE given, the image must be in demo mode.
echo "$HEALTH" | grep -q '"sosMode":"demo"'

curl -fsS "$BASE/" | grep -q "Sakho"

CHECK="$(curl -fsS -X POST "$BASE/api/scheme/check" -H 'Content-Type: application/json' \
  -d '{"schemeId":"pmmvy","answers":{}}')"
echo "$CHECK" | grep -q '"status":"questions_remaining"'

# The server must not run as root.
RUN_USER="$(docker exec "$NAME" id -u)"
[ "$RUN_USER" != "0" ] || { echo "Container runs as root" >&2; exit 1; }

echo "Smoke test passed for $IMAGE (uid $RUN_USER)"
