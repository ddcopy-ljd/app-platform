@echo off
cd /d "%~dp0"
title Stop Yizhen Platform Service

REM ============================================================
REM   Stop the YizhenPlatform Windows service (uvicorn, port 80)
REM   Requires Administrator privileges.
REM ============================================================

set "SVC=YizhenPlatform"

echo ============================================================
echo    Yizhen Platform  -  Stop Service
echo ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Administrator privileges required.
    echo         Right-click and choose Run as administrator.
    goto END
)

echo [1/3] Stopping service %SVC% ...
sc query %SVC% | findstr /I "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo       Service is already stopped.
) else (
    net stop %SVC% >nul 2>&1
    echo       Service stopped.
)

echo [2/3] Waiting for port 80 to be released ...
set "COUNT=0"
:WAIT
set /a COUNT+=1
netstat -ano -p tcp | findstr ":80 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto DONE
if %COUNT% GEQ 20 (
    echo [WARN] Port 80 is still listening after 20s. Please check manually.
    goto END
)
ping -n 2 127.0.0.1 >nul 2>&1
goto WAIT

:DONE
echo       Port 80 released.

echo [3/3] Service status:
sc query %SVC% | findstr /I "STATE"
echo.
echo ============================================================

:END
echo.
pause
