@echo off
REM Orion - package a distributable build with electron-builder.
setlocal
cd /d "%~dp0"

if not exist "electron\node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

echo Building the interface...
call npm run build --prefix frontend || goto :failed

echo.
echo Packaging with electron-builder ^(this takes a few minutes^)...
call npm run build --prefix electron || goto :failed

echo.
echo ============================================================
echo   Done. Installer and unpacked build are in electron\dist
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] Packaging failed - see the output above.
pause
exit /b 1
