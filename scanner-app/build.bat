@echo off
REM 一键构建手持机 APK（并在设备连接时自动安装）。
REM 用法：双击本文件，或在 Git Bash 中执行  cmd /c scanner-app/build.bat
setlocal

REM —— 本地 Android 工具链（路径含中文项目时需要显式设置）——
set ANDROID_HOME=C:\Android
set PATH=%PATH%;C:\Android\platform-tools;C:\Android\gradle-8.2\bin

REM 切换到本脚本所在目录（scanner-app）
cd /d "%~dp0"

echo ============================================
echo  构建懿臻珠宝云 · 手持机 (scanner-app)
echo  ANDROID_HOME = %ANDROID_HOME%
echo ============================================

call gradle assembleDebug --offline --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [BUILD FAILED] 构建失败，请根据上面的错误排查。
    exit /b 1
)

echo.
echo [BUILD OK] APK: app\build\outputs\apk\debug\app-debug.apk

REM 若手持机已通过 USB 连接并开启「USB 调试」，则直接安装
adb devices | findstr /r "\tdevice$" >nul
if %ERRORLEVEL%==0 (
    echo 检测到已连接设备，正在安装（覆盖旧包）...
    adb install -r app\build\outputs\apk\debug\app-debug.apk
) else (
    echo 未检测到 adb 设备。请把 app-debug.apk 拷到手持机存储后手动安装。
)
endlocal
