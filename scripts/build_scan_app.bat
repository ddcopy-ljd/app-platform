@echo off
cd /d "%~dp0.."
title Scan Assistant - Build Release APK

REM ============================================================
REM  Yizhen Scan Assistant (Android) - one-click release build
REM  Builds scan-assistant\ (module :app assembleRelease) and
REM  publishes the signed APK + MD5 sidecar into
REM    plugins\jewelry\downloads\scan-assistant-release.apk[.md5]
REM  so the plugin backend can serve in-app self-update.
REM
REM  ANDROID_HOME defaults to C:\Android; export the environment
REM  variable beforehand to override.
REM  Keep this .bat inside the project "scripts" folder.
REM ============================================================

if not defined ANDROID_HOME set "ANDROID_HOME=C:\Android"

set "APK=scan-assistant\app\build\outputs\apk\release\app-release.apk"
set "OUT=plugins\jewelry\downloads\scan-assistant-release.apk"

if not exist "scan-assistant\gradlew.bat" (
    echo [ERROR] scan-assistant\gradlew.bat not found.
    echo         Keep this .bat inside the project "scripts" folder.
    goto :END
)

echo ============================================================
echo    Building scan-assistant release APK ...
echo    ANDROID_HOME=%ANDROID_HOME%
echo ============================================================
echo.

cd scan-assistant
call gradlew.bat assembleRelease
set "RC=%ERRORLEVEL%"
cd /d "%~dp0.."

if not "%RC%"=="0" (
    echo.
    echo [FAILED] gradlew exited with code %RC% - read the messages above.
    echo          Check ANDROID_HOME / JDK / network, then retry.
    goto :END
)

if not exist "%APK%" (
    echo.
    echo [FAILED] APK not produced: %APK%
    goto :END
)

if not exist "plugins\jewelry\downloads" mkdir "plugins\jewelry\downloads"

copy /y "%APK%" "%OUT%" >nul
if errorlevel 1 (
    echo.
    echo [FAILED] Cannot copy APK to %OUT% .
    echo          The file may be locked/in use, or the path is not writable.
    echo          Close any running scan-assistant/plugin process and retry.
    goto :END
)

set "H="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%OUT%" MD5') do (
    set "H=%%h"
    goto :gotmd5
)
:gotmd5
set "H=%H: =%"
if "%H%"=="" (
    echo.
    echo [FAILED] Could not read MD5 via certutil for %OUT% .
    goto :END
)
> "%OUT%.md5" echo %H%

echo.
echo [OK] Build done.
echo      APK     : %OUT%
echo      MD5     : %H%
echo      Sidecar : %OUT%.md5

:END
echo.
pause
