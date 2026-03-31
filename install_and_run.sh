#!/bin/bash
# Digital Culture Notebook — Install & Run (macOS / Linux)
set -e

echo "========================================"
echo "  Digital Culture Notebook — Setup"
echo "========================================"
echo ""

# Check for Python 3
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo "  macOS:  brew install python3"
    echo "  Ubuntu: sudo apt install python3 python3-pip"
    exit 1
fi

# Check for ffmpeg
if ! command -v ffmpeg &>/dev/null; then
    echo "WARNING: ffmpeg is not installed (needed for video processing & transcription)."
    echo "  macOS:  brew install ffmpeg"
    echo "  Ubuntu: sudo apt install ffmpeg"
    echo ""
    read -p "Continue without ffmpeg? [y/N] " choice
    if [[ ! "$choice" =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Navigate to script directory
cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip -q
pip install -r requirements.txt -q

echo ""
echo "========================================"
echo "  Starting Digital Culture Notebook"
echo "  Open http://localhost:8080 in your browser"
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

cd app
python -m uvicorn main:app --host 0.0.0.0 --port 8080
