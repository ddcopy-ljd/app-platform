@echo off
cd /d "%~dp0.."
title Jewelry Cloud - Build Plugin Package

REM ============================================================
REM  Yizhen Jewelry Cloud - one-click plugin packaging
REM  Runs plugins\jewelry\build_package.py, output:
REM    plugins\jewelry\dist\jewelry_v{version}.zip
REM  Version is taken from plugins\jewelry\plugin.json
REM  (bump softwareVersion there before each release).
REM  Tip: commit your changes first - changes.lst is built
REM  from git history and uncommitted files are flagged.
REM ============================================================

set "PYEXE=C:\Python\Python313\python.exe"

if not exist "plugins\jewelry\build_package.py" (
    echo [ERROR] plugins\jewelry\build_package.py not found.
    echo         Keep this .bat inside the project "scripts" folder.
    goto END
)

if not exist "%PYEXE%" (
    echo [ERROR] System Python not found: %PYEXE%
    echo         Install Python 3.13 or edit PYEXE in this script.
    goto END
)

echo ============================================================
echo    Building jewelry plugin package ...
echo ============================================================
echo.

cd plugins\jewelry
"%PYEXE%" build_package.py
set "RC=%ERRORLEVEL%"
cd /d "%~dp0.."

echo.
if "%RC%"=="0" (
    echo [OK] Package ready. See zip under:
    echo      plugins\jewelry\dist\
) else (
    echo [FAILED] build_package.py exited with code %RC% - read the messages above.
)

:END
echo.
pause
