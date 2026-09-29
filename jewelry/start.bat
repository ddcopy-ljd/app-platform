@echo off
echo ========================================
echo   懿珠宝管家 - 启动服务
echo ========================================
echo.

cd /d "%~dp0server"

echo [1/2] 安装依赖...
pip install -r requirements.txt -q

echo.
echo [2/2] 启动服务...
echo 后端地址: http://localhost:8000
echo 前端地址: http://localhost:8000/apps/jewelry
echo API 文档: http://localhost:8000/docs
echo.

uvicorn app:app --host 0.0.0.0 --port 8000 --reload