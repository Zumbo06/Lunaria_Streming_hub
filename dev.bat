@echo off
REM Lunaria - development mode: Vite dev server with hot reload + Electron.
REM Closing this window stops both.
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

echo Starting Vite and Electron. Press Ctrl+C to stop both.
echo.
call npm run dev
