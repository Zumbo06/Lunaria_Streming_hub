@echo off
REM Lunaria - start the app with its console visible.
REM
REM Same as run.bat, but the window stays open and the engine logs everything it
REM does: torrent errors, buffering counts and every gateway request. Use this
REM when a stream fails and you need the reason rather than just the toast.
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

node "scripts\needs-build.js"
if not errorlevel 1 (
    echo Building the interface...
    call npm run build --prefix frontend || goto :failed
    echo.
)

REM The engine's own debug flag keeps its original name - see the note in
REM README.md about why the code is not renamed.
set ORION_DEBUG=1

echo Starting Lunaria with engine logging on.
echo Leave this window open - everything the engine reports appears here.
echo.

call npx electron .

echo.
echo Lunaria has exited. The log above is scrollable; copy anything marked
echo [engine], [engine ERR] or [gateway] when reporting a stream that failed.
pause
exit /b 0

:failed
echo.
echo [ERROR] Could not start Lunaria - see the output above.
pause
exit /b 1
