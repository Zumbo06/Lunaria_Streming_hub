@echo off
REM Lunaria - build the release.
REM
REM Produces, in release\:
REM   win-unpacked\                the app folder that ships: Lunaria.exe and everything beside it
REM   Lunaria-<version>-win.zip    that same folder zipped; unzip anywhere, drop an mpv folder beside it
REM
REM Settings and profiles live in %APPDATA%\Lunaria, not in the app folder.
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
    echo Dependencies are missing. Run setup.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "build\icon.ico" (
    echo Generating the app icon...
    call npm run icon || goto :failed
    echo.
)

echo Building the interface and packaging. This takes a few minutes.
echo.
call npm run dist || goto :failed

echo.
echo ============================================================
echo   Done. Ship release\win-unpacked\ - also zipped as:
echo.
dir /b "release\*.zip" 2>nul
echo.
echo   The build is unsigned, so Windows SmartScreen will warn on
echo   first run - More info then Run anyway.
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] Build failed - see the output above.
pause
exit /b 1
