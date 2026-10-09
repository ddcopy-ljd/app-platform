@echo off
cd /d "%~dp0"
title Register Yizhen Platform Service

REM ============================================================
REM   Register YizhenPlatform as a Windows service (via nssm)
REM   Requires Administrator privileges.
REM ============================================================

set "SVC=YizhenPlatform"
set "NSSM=C:\Windows\system32\nssm.exe"
set "PYEXE=%~dp0.venv\Scripts\python.exe"
set "APPDIR=%~dp0platform"
set "LOGDIR=%~dp0logs"

echo ============================================================
echo    Yizhen Platform  -  Register Windows Service
echo ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Administrator privileges required.
    echo         Right-click this file and choose Run as administrator.
    goto END
)

if not exist "%NSSM%" (
    echo [ERROR] nssm.exe not found: %NSSM%
    goto END
)

if not exist "%PYEXE%" (
    echo [ERROR] venv python not found: %PYEXE%
    goto END
)

if not exist "%APPDIR%\app\main.py" (
    echo [ERROR] platform\app\main.py not found.
    goto END
)

echo [1/5] Checking existing service ...
sc query %SVC% >nul 2>&1
if not errorlevel 1 (
    echo       Service already exists. Re-registering ...
    net stop %SVC% >nul 2>&1
    "%NSSM%" remove %SVC% confirm >nul 2>&1
    ping -n 3 127.0.0.1 >nul 2>&1
    echo       Old registration removed.
) else (
    echo       No existing service found.
)

echo [2/5] Preparing log directory ...
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo [3/5] Installing service %SVC% ...
"%NSSM%" install %SVC% "%PYEXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 80
if errorlevel 1 (
    echo [ERROR] Failed to install service.
    goto END
)
"%NSSM%" set %SVC% AppDirectory "%APPDIR%" >nul
"%NSSM%" set %SVC% DisplayName "Yizhen Platform" >nul
"%NSSM%" set %SVC% Description "Yizhen FastAPI platform (uvicorn on port 80)" >nul
"%NSSM%" set %SVC% Start SERVICE_AUTO_START >nul
"%NSSM%" set %SVC% AppStdout "%LOGDIR%\platform.out.log" >nul
"%NSSM%" set %SVC% AppStderr "%LOGDIR%\platform.err.log" >nul
"%NSSM%" set %SVC% AppExit Default Restart >nul
"%NSSM%" set %SVC% AppRestartDelay 5000 >nul
echo       Service installed.

echo [4/5] Injecting admin password from user environment ...
set "ADMPW="
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v PLATFORM_ADMIN_PASSWORD 2^>nul ^| findstr /I "PLATFORM_ADMIN_PASSWORD"') do set "ADMPW=%%b"
if defined ADMPW (
    "%NSSM%" set %SVC% AppEnvironmentExtra "PLATFORM_ADMIN_PASSWORD=%ADMPW%" >nul
    echo       Admin password injected.
) else (
    echo       [WARN] PLATFORM_ADMIN_PASSWORD not found; default admin123 will be used.
)

echo [5/5] Starting service and verifying ...
"%NSSM%" start %SVC% >nul 2>&1
set "COUNT=0"
:WAIT
set /a COUNT+=1
netstat -ano -p tcp | findstr ":80 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto READY
if %COUNT% GEQ 30 (
    echo [ERROR] Port 80 not listening within 30s.
    echo         Check log: %LOGDIR%\platform.err.log
    goto END
)
ping -n 2 127.0.0.1 >nul 2>&1
goto WAIT

:READY
echo       Service is running and port 80 is listening.
sc query %SVC% | findstr /I "STATE"
echo.
echo   Registered: %SVC%   Startup: Automatic
echo   Local     : http://localhost/
echo   Manage    : start_platform_service.bat / stop_platform_service.bat
echo ============================================================

:END
echo.
pause
