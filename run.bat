@echo off
REM Orion - start the app in development mode (Vite dev server + Electron)
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    pause
    exit /b 1
)

call npm run dev
