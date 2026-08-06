@echo off
REM Lunaria - one-time setup: dependencies, production build, player check.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   Lunaria - setup
echo ============================================================
echo.

REM ---- Node ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not on PATH.
    echo         Lunaria needs Node 22 or newer ^(WebTorrent 3 requires it^).
    echo         https://nodejs.org
    goto :failed
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
for /f %%v in ('node -p "process.versions.node"') do set NODE_FULL=%%v
if !NODE_MAJOR! LSS 22 (
    echo [ERROR] Node !NODE_FULL! is too old. Lunaria needs Node 22 or newer.
    goto :failed
)
echo   Node !NODE_FULL!  OK
echo.

REM ---- Dependencies ----
echo [1/4] Root tooling ^(concurrently, wait-on, cross-env^)...
call npm install --silent || goto :failed

echo [2/4] Frontend ^(React, Vite, Tailwind^)...
call npm install --prefix frontend --silent || goto :failed

echo [3/4] Electron shell and WebTorrent engine ^(this one is large^)...
call npm install --prefix electron --silent || goto :failed

echo [4/4] Building the interface...
call npm run build --prefix frontend --silent || goto :failed
echo.

REM ---- Players ----
echo ------------------------------------------------------------
echo   Players
echo ------------------------------------------------------------
set FOUND_PLAYER=0

set "VLC_PATH="
if exist "%ProgramFiles%\VideoLAN\VLC\vlc.exe" set "VLC_PATH=%ProgramFiles%\VideoLAN\VLC\vlc.exe"
if exist "%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe" set "VLC_PATH=%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe"
if defined VLC_PATH (
    echo   VLC  found   !VLC_PATH!
    set FOUND_PLAYER=1
) else (
    echo   VLC  missing  - https://www.videolan.org/vlc/
)

REM mpv is usually a portable folder rather than an install, so ask the app's own
REM discovery rather than guessing at paths here.
for /f "delims=" %%m in ('node -e "try{const m=require('./electron/mpv.js');m.findMpv(null).then(p=>console.log(p||'')).catch(()=>console.log(''))}catch(e){console.log('')}" 2^>nul') do set "MPV_PATH=%%m"
if defined MPV_PATH (
    echo   mpv  found   !MPV_PATH!
    set FOUND_PLAYER=1
) else (
    echo   mpv  missing  - optional, but the better choice for HDR
    echo                  portable builds are detected automatically
)
echo.

if !FOUND_PLAYER! EQU 0 (
    echo   [WARNING] No player found. Lunaria decodes nothing itself, so install
    echo             VLC or mpv before trying to play anything. You can also
    echo             point Lunaria at an executable in Settings.
    echo.
)

echo ============================================================
echo   Setup complete.
echo.
echo     run.bat     start Lunaria
echo     debug.bat   start with the console visible and engine logging on
echo     dev.bat     start with hot reload ^(for development^)
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] Setup failed - see the output above.
echo.
pause
exit /b 1
