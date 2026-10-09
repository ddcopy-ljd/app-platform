@echo off
cd /d "%~dp0"
title Unregister Yizhen Platform Service

REM ============================================================
REM   Unregister YizhenPlatform Windows service (via nssm)
REM   Requires Administrator privileges.
REM   Only removes the service registration.
REM   Project files, venv and data are NOT deleted.
REM ============================================================

set "SVC=YizhenPlatform"
set "NSSM=C:\Windows\system32\nssm.exe"

echo ============================================================
echo    Yizhen Platform  -  Unregister Windows Service
echo ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Administrator privileges required.
    echo         Right-click this file and choose Run as administrator.
    goto END
)

echo [1/4] Checking service %SVC% ...
sc query %SVC% >nul 2>&1
if errorlevel 1 (
    echo       Service %SVC% does not exist. Nothing to do.
    goto END
)
echo       Service found.

echo [2/4] Stopping service ...
net stop %SVC% >nul 2>&1
ping -n 3 127.0.0.1 >nul 2>&1
echo       Stop command issued.

echo [3/4] Removing service registration ...
if exist "%NSSM%" (
    "%NSSM%" remove %SVC% confirm >nul 2>&1
)
sc query %SVC% >nul 2>&1
if not errorlevel 1 (
    echo       nssm remove failed, trying sc delete ...
    sc delete %SVC% >nul 2>&1
    ping -n 3 127.0.0.1 >nul 2>&1
)

echo [4/4] Verifying ...
sc query %SVC% >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Service %SVC% still exists. Please remove manually.
    goto END
)
echo       Service removed successfully.
netstat -ano -p tcp | findstr ":80 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo       Port 80 is free.
) else (
    echo       [WARN] Port 80 is still in use by another process.
)
echo.
echo ============================================================
echo   Unregistered: %SVC%
echo   Note: project files and data are not affected.
echo ============================================================

:END
echo.
pause
