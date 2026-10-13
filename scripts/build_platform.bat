@echo off
cd /d "%~dp0.."
title Build Platform Package

REM ============================================================
REM   Platform zip builder (pure platform, no plugins/android).
REM   No args        : bump VERSION (revision+1, date refreshed) then build.
REM   With args      : pass through to build_all.py, e.g.
REM     build_platform.bat --platform-only          (repack same version)
REM     build_platform.bat                          (bump + repack)
REM   Output: dist\yizhen-platform_v{VERSION}.zip
REM ============================================================

set "PYEXE=%~dp0..\.venv\Scripts\python.exe"

if not exist "%PYEXE%" (
    echo [ERROR] venv python not found: %PYEXE%
    goto END
)

if "%~1"=="" (
    set "ARGS=--platform-only --bump"
) else (
    set "ARGS=%*"
)

echo ============================================================
echo    python : %PYEXE%
echo    args   : %ARGS%
echo ============================================================
"%PYEXE%" platform\build_all.py %ARGS%
if errorlevel 1 (
    echo [ERROR] Build failed.
    goto END
)
echo.
echo Done. Package is in dist\ (see path printed above).

:END
pause
