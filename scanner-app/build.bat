@echo off
setlocal
REM Local Android toolchain (explicit path because the project path contains CJK chars)
set ANDROID_HOME=C:\Android
set PATH=%PATH%;C:\Android\platform-tools;C:\Android\gradle-8.2\bin
cd /d "%~dp0"

echo ============================================
echo  Build scanner-app (Yizhen Jewelry Cloud handheld)
echo  ANDROID_HOME = %ANDROID_HOME%
echo ============================================

call gradle assembleDebug --offline --no-daemon --console=plain
if errorlevel 1 goto BUILDFAIL

echo.
echo [BUILD OK] APK: app\build\outputs\apk\debug\app-debug.apk
echo.

echo Installing to connected handheld (USB debugging on), if any...
adb install -r "app\build\outputs\apk\debug\app-debug.apk"
if errorlevel 1 goto INSTALLFAIL

echo Install done.
goto END

:BUILDFAIL
echo.
echo [BUILD FAILED] see errors above.
goto END

:INSTALLFAIL
echo Install skipped or failed. Copy app-debug.apk to the handheld and install manually.
goto END

:END
endlocal

pause