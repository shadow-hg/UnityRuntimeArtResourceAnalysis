#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)/.."
FRONTEND_DIR="$ROOT_DIR/unity-telemetry-viewer"
DIST_DIR="$FRONTEND_DIR/dist"
TARGET_DIR="$ROOT_DIR/unity-telemetry-viewer/dist"

echo "Installing frontend dependencies in $FRONTEND_DIR..."
npm --prefix "$FRONTEND_DIR" install --no-audit --no-fund

echo "Building frontend..."
npm --prefix "$FRONTEND_DIR" run build

if [ ! -d "$DIST_DIR" ]; then
  echo "Build failed: dist not found at $DIST_DIR"
  exit 1
fi

# Copy dist to server-accessible location (server serves ../unity-telemetry-viewer/dist as /static)
# Here we simply ensure the dist exists (no copy needed if building in place). If you instead build elsewhere,
# adjust this script to copy artifacts into the server folder.

echo "Frontend built to $DIST_DIR. Server will serve it via /static (already pointing at $DIST_DIR)."

echo "Done."
