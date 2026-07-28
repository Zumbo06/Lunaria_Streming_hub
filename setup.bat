@echo off
REM Orion - one-time dependency install
setlocal
cd /d "%~dp0"

echo ============================================
echo  Orion - installing dependencies
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found on PATH. Install Node 22 or newer.
    pause
    exit /b 1
)

echo [1/3] Root tooling...
call npm install || goto :failed

echo [2/3] Frontend (React + Vite + Tailwind)...
call npm install --prefix frontend || goto :failed

echo [3/3] Electron shell + WebTorrent engine...
call npm install --prefix electron || goto :failed

echo.
echo Done. Run run.bat to start Orion.
echo.
if not exist "%ProgramFiles%\VideoLAN\VLC\vlc.exe" (
    if not exist "%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe" (
        echo [NOTE] VLC was not found in the default install locations.
        echo        Install VLC, or set its path in Orion's Settings screen.
        echo.
    )
)
pause
exit /b 0

:failed
echo.
echo [ERROR] Install failed. See the output above.
pause
exit /b 1
