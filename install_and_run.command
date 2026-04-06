#!/bin/bash
# MediaScope — Install & Run (macOS / Linux)
set -e

echo "========================================"
echo "  MediaScope — Setup"
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

# Check for ffmpeg and auto-install if missing
if ! command -v ffmpeg &>/dev/null; then
    echo "ffmpeg is not installed (needed for video processing & transcription)."
    echo "Attempting to install automatically..."
    echo ""

    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS — install via Homebrew
        if ! command -v brew &>/dev/null; then
            echo "Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            # Add Homebrew to PATH for Apple Silicon and Intel Macs
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            elif [ -f /usr/local/bin/brew ]; then
                eval "$(/usr/local/bin/brew shellenv)"
            fi
        fi
        echo "Installing ffmpeg via Homebrew (this may take a few minutes)..."
        brew install ffmpeg
    else
        # Linux
        echo "Installing ffmpeg via apt..."
        sudo apt update && sudo apt install -y ffmpeg
    fi

    if ! command -v ffmpeg &>/dev/null; then
        echo ""
        echo "WARNING: ffmpeg installation failed. Video trimming and transcription won't work."
        read -p "Continue anyway? [y/N] " choice
        if [[ ! "$choice" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "ffmpeg installed successfully!"
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

# Kill any leftover server from a previous run
lsof -ti:8080 | xargs kill -9 2>/dev/null || true

echo ""
echo "========================================"
echo "  Starting MediaScope"
echo "  Open http://localhost:8080 in your browser"
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

# Ensure the server is stopped when this script exits
cleanup() {
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Open the browser once the server is actually ready
(
    for i in $(seq 1 30); do
        curl -s -o /dev/null http://localhost:8080/ && break
        sleep 1
    done
    open "http://localhost:8080"
) &

cd app
python -m uvicorn main:app --host 0.0.0.0 --port 8080
