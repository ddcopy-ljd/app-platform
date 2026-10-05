@echo off
cd /d "%~dp0"
title Jewelry Cloud 8002 - close this window to STOP

REM ============================================================
REM  Yizhen Jewelry Cloud - start on port 8002
REM  Binds 0.0.0.0 so C27 RFID devices on the same Wi-Fi/LAN
REM  can join the collaborative stocktake task.
REM  Uses system Python (firewall allowed) + .venv packages.
REM ============================================================

set "HOST=0.0.0.0"
set "PORT=8002"
set "PYEXE=C:\Python\Python313\python.exe"
set "PYTHONPATH=%~dp0.venv\Lib\site-packages"

echo ============================================================
echo    Yizhen Jewelry Cloud  -  Port %PORT%
echo ============================================================

if not exist "plugins\jewelry\main.py" (
    echo [ERROR] plugins\jewelry\main.py not found.
    echo         Put this .bat in the project root, next to "plugins" and ".venv".
    goto END
)

if not exist "%PYEXE%" (
    echo [ERROR] System Python not found: %PYEXE%
    echo         Install Python 3.13 or edit PYEXE in this script.
    goto END
)

netstat -ano -p tcp | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port %PORT% is already in use - service may already be running.
    echo         Close the old service window first.
    goto END
)

echo    PC / browser : http://localhost:%PORT%
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|VMware|WSL|VirtualBox|Bluetooth|Docker' -and $_.IPAddress -notmatch '^169\.254' } | ForEach-Object { Write-Host ('   C27 handheld : http://' + $_.IPAddress + ':' + $env:PORT + '   (same Wi-Fi required)') }"
echo    Login        : admin / 123456
echo ------------------------------------------------------------
echo    Waiting for "Uvicorn running" ... keep this window OPEN.
echo ============================================================
echo.

"%PYEXE%" plugins\jewelry\main.py

echo.
echo Service stopped (if unexpected, check the error above).

:END
echo.
pause
