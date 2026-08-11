@echo off
REM Lunaria - build the portable release.
REM
REM Produces two artifacts in release\:
REM   Lunaria-<version>-portable.exe   one file, double-click, nothing installed
REM   Lunaria-<version>-win-x64.zip    unzip anywhere; drop an mpv folder beside it
REM
REM Both keep their data in LunariaData\ next to the exe rather than in
REM %APPDATA%, so the folder carries the whole install.
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
echo   Done. Artifacts are in release\
echo.
dir /b "release\*.exe" "release\*.zip" 2>nul
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
