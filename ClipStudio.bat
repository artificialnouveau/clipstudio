@echo off
REM ClipStudio — Quick Launch
REM Double-click this file to start the app

cd /d "%~dp0"

REM Check if venv exists (already installed)
if not exist ".venv" (
    echo First time? Running installer first...
    echo.
    call install_and_run.bat
    exit /b 0
)

REM Activate virtual environment
call .venv\Scripts\activate.bat

echo ========================================
echo   Starting ClipStudio...
echo   Closing this window will stop the app.
echo ========================================
echo.

REM Open browser
start http://localhost:8080

cd app
python -m uvicorn main:app --host 127.0.0.1 --port 8080
pause
