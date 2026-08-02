@echo off
REM Orion - start the app.
setlocal
cd /d "%~dp0"

if not exist "electron\node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

REM The built interface is what Electron loads; rebuild if it is missing so a
REM fresh checkout still starts.
if not exist "frontend\dist\index.html" (
    echo Building the interface for the first time...
    call npm run build --prefix frontend || goto :failed
)

start "" /b cmd /c "npm run start --prefix electron"
exit /b 0

:failed
echo.
echo [ERROR] Could not start Orion - see the output above.
pause
exit /b 1
