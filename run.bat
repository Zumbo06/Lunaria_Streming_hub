@echo off
REM Lunaria - start the app.
setlocal
cd /d "%~dp0"

if not exist "electron\node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

REM The built interface is what Electron loads. Rebuild it whenever its sources
REM are newer than the last build - checking only for a missing folder, as this
REM script used to, meant every edit was silently ignored.
node "scripts\needs-build.js"
if not errorlevel 1 (
    echo Building the interface...
    call npm run build --prefix frontend || goto :failed
    echo.
)

REM Detached, so this window can close - but the output still goes somewhere.
REM A startup crash used to vanish entirely, leaving nothing to look at.
if not exist "logs" mkdir "logs"
start "" /b cmd /c "npm run start --prefix electron > logs\lunaria.log 2>&1"

echo Lunaria is starting.
echo.
echo   If the window does not appear, see logs\lunaria.log
echo   For live engine logging, use debug.bat instead.
exit /b 0

:failed
echo.
echo [ERROR] Could not start Lunaria - see the output above.
pause
exit /b 1
