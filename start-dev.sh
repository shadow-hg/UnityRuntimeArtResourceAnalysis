#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
WEB_DIR="$ROOT_DIR/web"

SERVER_PORT="${SERVER_PORT:-48080}"
WEB_PORT="${WEB_PORT:-5175}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run this script." >&2
  exit 1
fi

kill_port() {
  local port="$1"
  echo "Ensuring port $port is available..."
  npx --yes kill-port "$port" >/dev/null 2>&1 || true
}

kill_port "$SERVER_PORT"
kill_port "$WEB_PORT"

trap 'echo "Stopping dev servers..."; kill 0' EXIT

( cd "$SERVER_DIR" && echo "Starting API server on port $SERVER_PORT" && PORT="$SERVER_PORT" npm run dev ) &
SERVER_PID=$!

( cd "$WEB_DIR" && echo "Starting web client on port $WEB_PORT" && PORT="$WEB_PORT" npm run dev ) &
WEB_PID=$!

wait $SERVER_PID $WEB_PID
