@echo off
cd /d "%~dp0.."
title Platform 80 - close this window to STOP

REM ============================================================
REM   ƽ̨���������ű�
REM   ���: platform\app\main.py  (FastAPI + Uvicorn)
REM ============================================================

set "HOST=0.0.0.0"
set "PORT=80"
set "PYEXE=%~dp0..\.venv\Scripts\python.exe"

REM Agent pipeline is enabled only when env var AGENT_API_KEY is set (X-Agent-Key).
REM Set it once at user level, e.g. in PowerShell:
REM   [Environment]::SetEnvironmentVariable('AGENT_API_KEY','your-new-key','User')
REM then reopen this window. Never put the key itself in this file.

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

cd /d "%~dp0..\platform"
"%PYEXE%" -m uvicorn app.main:app --host %HOST% --port %PORT%

echo.
echo Service stopped (if unexpected, check the error above).

:END
echo.
pause
