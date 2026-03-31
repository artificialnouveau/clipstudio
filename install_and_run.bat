@echo off
REM Digital Culture Notebook — Install & Run (Windows)

echo ========================================
echo   Digital Culture Notebook — Setup
echo ========================================
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed.
    echo Download it from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

REM Check for ffmpeg
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo WARNING: ffmpeg is not installed (needed for video processing ^& transcription^).
    echo Download from https://ffmpeg.org/download.html
    echo.
    set /p choice="Continue without ffmpeg? [y/N] "
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
echo   Starting Digital Culture Notebook
echo   Open http://localhost:8080 in your browser
echo   Press Ctrl+C to stop
echo ========================================
echo.

cd app
python -m uvicorn main:app --host 0.0.0.0 --port 8080
pause
