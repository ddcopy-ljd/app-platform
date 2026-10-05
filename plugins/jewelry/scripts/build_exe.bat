@echo off
rem 一键打包本地打印桥为单文件 exe（需已安装 Python 3.9+）
rem 产物：dist\PrintBridge.exe（把 exe 单独拷到店里笔记本即可运行）

cd /d "%~dp0"

echo [1/2] 安装/更新 PyInstaller...
python -m pip install --quiet --disable-pip-version-check pyinstaller || goto :err

echo [2/2] 打包...
python -m PyInstaller --onefile --console --name PrintBridge --clean -y print_agent.py || goto :err

echo.
echo 打包完成：%~dp0dist\PrintBridge.exe
echo 使用：把 exe 拷到店里电脑，双击运行，按提示填云端地址与桥接密钥。
pause
exit /b 0

:err
echo 打包失败，请检查 Python 环境后重试。
pause
exit /b 1
