@echo off
REM MediaScope — Install & Run (Windows)

echo ========================================
echo   MediaScope — Setup
echo ========================================
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python 3 is not installed.
    echo.
    echo Please install Python first:
    echo   1. Go to https://www.python.org/downloads/
    echo   2. Download and install Python 3
    echo   3. IMPORTANT: Check "Add Python to PATH" during installation
    echo   4. Then double-click this file again
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Check for ffmpeg
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo WARNING: ffmpeg is not installed (needed for video processing ^& transcription^).
    echo.
    echo To install: download from https://ffmpeg.org/download.html
    echo.
    set /p choice="Continue without ffmpeg for now? [y/N] "
    if /i not "%choice%"=="y" exit /b 1
)

REM Navigate to script directory
cd /d "%~dp0"

REM Create virtual environment if it doesn't exist
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

REM Activate virtual environment
call .venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install --upgrade pip -q
pip install -r requirements.txt -q

echo.
echo ========================================
echo   Starting MediaScope
echo   Opening browser...
echo   Press Ctrl+C to stop
echo ========================================
echo.

REM Open browser automatically
start http://localhost:8080

cd app
python -m uvicorn main:app --host 0.0.0.0 --port 8080
pause
