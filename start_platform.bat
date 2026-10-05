@echo off
cd /d "%~dp0"
title Platform 8000 - close this window to STOP

REM ============================================================
REM   平台核心启动脚本
REM   入口: platform\app\main.py  (FastAPI + Uvicorn)
REM ============================================================

set "HOST=0.0.0.0"
set "PORT=8000"
set "PYEXE=%~dp0.venv\Scripts\python.exe"

echo ============================================================
echo    Platform  -  Port %PORT%
echo ============================================================

if not exist "platform\app\main.py" (
    echo [ERROR] platform\app\main.py not found.
    echo         Put this .bat in the project root.
    goto END
)

if not exist "%PYEXE%" (
    echo [ERROR] venv python not found: %PYEXE%
    goto END
)

netstat -ano -p tcp | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port %PORT% is already in use.
    goto END
)

echo    Local  : http://localhost:%PORT%
echo    Login  : admin / admin123
echo    LAN    : use one of these IPv4 addresses with :%PORT%
ipconfig | findstr "IPv4"
echo ------------------------------------------------------------
echo    Waiting for "Uvicorn running" ... keep this window OPEN.
echo ============================================================
echo.

cd /d "%~dp0platform"
"%PYEXE%" -m uvicorn app.main:app --host %HOST% --port %PORT%

echo.
echo Service stopped (if unexpected, check the error above).

:END
echo.
pause
