@echo off
cd /d "%~dp0"
title Start Yizhen Platform Service

REM ============================================================
REM   Start the YizhenPlatform Windows service (uvicorn, port 80)
REM   Requires Administrator privileges.
REM ============================================================

set "SVC=YizhenPlatform"
set "LOGDIR=%~dp0logs"

echo ============================================================
echo    Yizhen Platform  -  Start Service
echo ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Administrator privileges required.
    echo         Right-click and choose Run as administrator.
    goto END
)

echo [1/3] Starting service %SVC% ...
sc query %SVC% | findstr /I "RUNNING" >nul 2>&1
if not errorlevel 1 (
    echo       Service is already running.
) else (
    net start %SVC% >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to start service %SVC%.
        echo         Check log: %LOGDIR%\platform.err.log
        goto END
)
    echo       Service started.
)

echo [2/3] Waiting for port 80 to listen ...
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
echo       Port 80 is listening.

echo [3/3] Service status:
sc query %SVC% | findstr /I "STATE"
echo.
echo   Local : http://localhost/
echo   Login : admin / (see PLATFORM_ADMIN_PASSWORD)
echo.
echo   Service runs in background. Use stop_platform_service.bat to stop it.
echo ============================================================

:END
echo.
pause
