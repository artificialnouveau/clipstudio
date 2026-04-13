#!/bin/bash
# ClipStudio — Install & Run (macOS / Linux)
set -e

echo "========================================"
echo "  ClipStudio — Setup"
echo "========================================"
echo ""

# Check for Python 3
if ! command -v python3 &>/dev/null; then
    echo ""
    echo "ERROR: Python 3 is not installed."
    echo ""
    echo "Please install Python first:"
    echo "  1. Go to https://www.python.org/downloads/"
    echo "  2. Download and install Python 3"
    echo "  3. Then double-click this file again"
    echo ""
    # On macOS, try to open the download page
    if command -v open &>/dev/null; then
        open "https://www.python.org/downloads/"
    fi
    read -p "Press Enter to close..."
    exit 1
fi

# Check for ffmpeg
if ! command -v ffmpeg &>/dev/null; then
    echo "WARNING: ffmpeg is not installed (needed for video processing & transcription)."
    echo ""
    echo "To install ffmpeg:"
    echo "  macOS:  Open Terminal and run: brew install ffmpeg"
    echo "  Linux:  sudo apt install ffmpeg"
    echo ""
    read -p "Continue without ffmpeg for now? [y/N] " choice
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
echo "  Starting ClipStudio"
echo "  Open http://localhost:8080 in your browser"
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

# Open the browser automatically after a short delay
(sleep 3 && open "http://localhost:8080") &

cd app
python -m uvicorn main:app --host 127.0.0.1 --port 8080
