#!/usr/bin/env bash
set -euo pipefail

MAX_RESTARTS=${MAX_RESTARTS:-30}
RESTART_DELAY_SEC=${RESTART_DELAY_SEC:-5}
BACKOFF_SEC=${BACKOFF_SEC:-2}

count=0
while [ "$count" -lt "$MAX_RESTARTS" ]; do
  count=$((count + 1))
  delay=$((RESTART_DELAY_SEC + (count - 1) * BACKOFF_SEC))
  echo "[SUPERVISOR] Starting organism (attempt $count/$MAX_RESTARTS)..."
  node dist/agents/orchestrator.js && exit 0
  echo "[SUPERVISOR] Organism exited. Restarting in ${delay}s..."
  sleep "$delay"
done
echo "[SUPERVISOR] Max restarts reached ($MAX_RESTARTS). Giving up."
exit 1
