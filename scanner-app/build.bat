@echo off
REM One-click build for the handheld app (and auto-install if a device is connected).
REM Usage: double-click this file, or in Git Bash run:  cmd /c scanner-app/build.bat
setlocal

REM Local Android toolchain (explicit path needed because the project path contains CJK chars)
set ANDROID_HOME=C:\Android
set PATH=%PATH%;C:\Android\platform-tools;C:\Android\gradle-8.2\bin

REM cd to this script's directory (scanner-app)
cd /d "%~dp0"

echo ============================================
echo  Build scanner-app (Yizhen Jewelry Cloud handheld)
echo  ANDROID_HOME = %ANDROID_HOME%
echo ============================================

call gradle assembleDebug --offline --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [BUILD FAILED] see errors above.
    exit /b 1
)

echo.
echo [BUILD OK] APK: app\build\outputs\apk\debug\app-debug.apk

REM If the handheld is connected via USB with "USB debugging" on, install it
adb devices | findstr /r "\tdevice$" >nul
if %ERRORLEVEL%==0 (
    echo Device detected, installing (replacing old package)...
    adb install -r app\build\outputs\apk\debug\app-debug.apk
) else (
    echo No adb device detected. Copy app-debug.apk to the handheld and install manually.
)
endlocal
