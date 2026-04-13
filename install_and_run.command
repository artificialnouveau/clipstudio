#!/bin/bash
# ClipStudio — Install & Run (macOS / Linux)
set -e

PORT=8080

echo "========================================"
echo "  ClipStudio — Setup"
echo "========================================"
echo ""

fail() {
    echo ""
    echo "ERROR: $1"
    echo ""
    read -p "Press Enter to close..."
    exit 1
}

# Check for Python 3
if ! command -v python3 &>/dev/null; then
    echo "Python 3 is not installed."
    echo ""
    echo "Please install Python first:"
    echo "  1. Go to https://www.python.org/downloads/"
    echo "  2. Download and install Python 3.10 or newer"
    echo "  3. Then double-click this file again"
    echo ""
    if command -v open &>/dev/null; then
        open "https://www.python.org/downloads/"
    fi
    read -p "Press Enter to close..."
    exit 1
fi

# Check Python version is 3.10+
PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 9) else 0)' 2>/dev/null || echo "0")
if [ "$PY_OK" != "1" ]; then
    fail "Python $PY_VERSION is too old. ClipStudio needs Python 3.9 or newer.
Install a newer version from https://www.python.org/downloads/"
fi
echo "Python $PY_VERSION detected."

# Check for ffmpeg and auto-install if missing
if ! command -v ffmpeg &>/dev/null; then
    echo "ffmpeg is not installed (needed for video processing & transcription)."
    echo "Attempting to install automatically..."
    echo ""

    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS — install via Homebrew
        if ! command -v brew &>/dev/null; then
            echo "Installing Homebrew first..."
            if ! /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
                fail "Homebrew install failed. Check your internet connection, then install Homebrew manually from https://brew.sh and re-run this script."
            fi
            # Add Homebrew to PATH for Apple Silicon and Intel Macs
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            elif [ -f /usr/local/bin/brew ]; then
                eval "$(/usr/local/bin/brew shellenv)"
            fi
        fi
        echo "Installing ffmpeg via Homebrew (this may take a few minutes)..."
        if ! brew install ffmpeg; then
            echo "WARNING: 'brew install ffmpeg' failed. You can try manually with: brew install ffmpeg"
        fi
    else
        # Linux
        echo "Installing ffmpeg via apt..."
        sudo apt update && sudo apt install -y ffmpeg || echo "WARNING: apt install failed."
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

# Sanity check repo layout
if [ ! -f "requirements.txt" ]; then
    fail "requirements.txt not found in $(pwd).
Make sure you're running this script from inside the unzipped ClipStudio folder."
fi
if [ ! -d "app" ] || [ ! -f "app/main.py" ]; then
    fail "The 'app/' folder or 'app/main.py' is missing from $(pwd).
Re-download ClipStudio and try again — your copy looks incomplete."
fi

# If a venv exists, make sure it still works (right Python version, key packages
# importable). If it's broken or stale from an earlier failed run, rebuild it.
if [ -d ".venv" ]; then
    VENV_OK=1
    if [ ! -f ".venv/bin/python" ]; then
        VENV_OK=0
    else
        if ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
            VENV_OK=0
        fi
    fi
    if [ "$VENV_OK" = "0" ]; then
        echo "Existing .venv is incompatible or broken. Rebuilding it..."
        rm -rf .venv
    fi
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    if ! python3 -m venv .venv; then
        fail "Failed to create the Python virtual environment.
Try installing the venv module:  python3 -m pip install --user virtualenv
Or reinstall Python from https://www.python.org/downloads/"
    fi
fi

# Activate virtual environment
if [ ! -f ".venv/bin/activate" ]; then
    fail "The virtual environment is corrupted (.venv/bin/activate missing).
Delete the .venv folder and re-run this script:  rm -rf .venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# Install dependencies
echo "Installing dependencies (first run can take a few minutes)..."
if ! pip install --upgrade pip -q; then
    fail "Failed to upgrade pip. Check your internet connection and try again.
If you're behind a proxy or firewall, that may be blocking PyPI."
fi
if ! pip install -r requirements.txt -q; then
    echo ""
    echo "Dependency install failed. Retrying with full output so you can see the error..."
    echo ""
    pip install -r requirements.txt || fail "pip install failed.
Common causes:
  - No internet connection (check Wi-Fi)
  - PyPI blocked by a firewall, VPN, or corporate proxy
  - Out of disk space (faster-whisper + torch need ~2 GB)
  - Python version mismatch (need 3.10+)
Try deleting the .venv folder and re-running:  rm -rf .venv"
fi

# Check whether port 8080 is already in use
EXISTING_PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    EXISTING_CMD=$(ps -p "$EXISTING_PID" -o comm= 2>/dev/null || echo "unknown")
    echo "Port $PORT is already in use by PID $EXISTING_PID ($EXISTING_CMD)."
    if [[ "$EXISTING_CMD" == *python* ]] || [[ "$EXISTING_CMD" == *uvicorn* ]]; then
        echo "Looks like a leftover ClipStudio server. Killing it..."
        kill -9 $EXISTING_PID 2>/dev/null || true
        sleep 1
    else
        echo ""
        echo "Another app is using port $PORT. ClipStudio cannot start until it's free."
        echo "Either quit that app, or kill the process with:  kill -9 $EXISTING_PID"
        read -p "Kill PID $EXISTING_PID now? [y/N] " choice
        if [[ "$choice" =~ ^[Yy]$ ]]; then
            kill -9 $EXISTING_PID 2>/dev/null || true
            sleep 1
        else
            fail "Port $PORT still in use. Aborting."
        fi
    fi
fi

echo ""
echo "========================================"
echo "  Starting ClipStudio"
echo "  Open http://localhost:$PORT in your browser"
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

# Ensure the server is stopped when this script exits
cleanup() {
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Open the browser once the server is actually ready
(
    for i in $(seq 1 30); do
        if curl -s -o /dev/null "http://localhost:$PORT/"; then
            open "http://localhost:$PORT"
            exit 0
        fi
        sleep 1
    done
    echo ""
    echo "WARNING: server didn't respond on http://localhost:$PORT after 30 seconds."
    echo "Check the Terminal output above for an error message from uvicorn."
) &

cd app
# Run uvicorn; if it exits non-zero, surface a hint instead of vanishing
if ! python -m uvicorn main:app --host 127.0.0.1 --port $PORT; then
    echo ""
    echo "ERROR: the ClipStudio server crashed or failed to start."
    echo ""
    echo "Common causes:"
    echo "  - Port $PORT taken by another app (try: lsof -ti:$PORT)"
    echo "  - A Python import error in app/main.py (scroll up for the traceback)"
    echo "  - Database file locked or corrupted (app/notebook.db)"
    echo "  - Missing dependency (try deleting .venv and re-running this script)"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi
