#!/usr/bin/env bash
# Start Browser Bridge Server
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=${BRIDGE_PORT:-8766}

# Check if server is already running
PID=$(lsof -ti -sTCP:LISTEN :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Port $PORT is already in use by PID $PID. Killing old server instance..."
  kill -9 $PID 2>/dev/null
  sleep 1
fi

echo "Starting Browser Bridge Server on port $PORT..."
node "$DIR/bridge/server.js"
