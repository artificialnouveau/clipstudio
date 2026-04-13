#!/bin/bash
# ClipStudio — Quick Launch
# Double-click this file to start the app

cd "$(dirname "$0")"

# Activate virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    echo "First time? Running installer first..."
    echo ""
    ./install_and_run.command
    exit 0
fi

# Kill any leftover server from a previous run
lsof -ti:8080 | xargs kill -9 2>/dev/null || true

echo "========================================"
echo "  Starting ClipStudio..."
echo "  Closing this window will stop the app."
echo "========================================"
echo ""

# Ensure the server is stopped when this script exits
cleanup() {
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Open browser once the server is actually ready
(
    for i in $(seq 1 30); do
        curl -s -o /dev/null http://localhost:8080/ && break
        sleep 1
    done
    open "http://localhost:8080"
) &

cd app
python -m uvicorn main:app --host 127.0.0.1 --port 8080
