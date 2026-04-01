#!/bin/bash
# Digital Culture Notebook — Quick Launch
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

echo "========================================"
echo "  Starting Digital Culture Notebook..."
echo "  Closing this window will stop the app."
echo "========================================"
echo ""

# Open browser after server starts
(sleep 2 && open "http://localhost:8080") &

cd app
python -m uvicorn main:app --host 0.0.0.0 --port 8080
