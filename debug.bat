@echo off
REM Orion - start the app with its console visible.
REM
REM Same as run.bat, but the window stays open and the engine logs everything it
REM does: torrent errors, buffering counts and every gateway request. Use this
REM when a stream fails and you need the reason rather than just the toast.
setlocal
cd /d "%~dp0"

if not exist "electron\node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "frontend\dist\index.html" (
    echo Building the interface for the first time...
    call npm run build --prefix frontend || goto :failed
)

set ORION_DEBUG=1

echo Starting Orion with engine logging on.
echo Leave this window open - everything the engine reports appears here.
echo.

call npm run start --prefix electron

echo.
echo Orion has exited. The log above is scrollable; copy anything marked
echo [engine], [engine ERR] or [gateway] when reporting a stream that failed.
pause
exit /b 0

:failed
echo.
echo [ERROR] Could not start Orion - see the output above.
pause
exit /b 1
