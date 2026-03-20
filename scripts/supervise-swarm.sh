#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MAX_RESTARTS=${MAX_RESTARTS:-30}
RESTART_DELAY_SEC=${RESTART_DELAY_SEC:-5}
BACKOFF_SEC=${BACKOFF_SEC:-2}
retries=0

while true; do
  if [ "$retries" -ge "$MAX_RESTARTS" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Max restarts reached ($MAX_RESTARTS); exiting."
    exit 0
  fi

  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting swarm-mind orchestrator (attempt $((retries + 1)))"
  if ! node dist/agents/runner-orchestrator.js; then
    exit_code=$?
    retries=$((retries + 1))
    delay=$((RESTART_DELAY_SEC + (retries * BACKOFF_SEC)))
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Process exited (${exit_code}); restarting in ${delay}s"
    sleep "$delay"
    continue
  fi

  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Process exited cleanly; stopping supervisor."
  break
 done
