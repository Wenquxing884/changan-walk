@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\vite\bin\vite.js" (
  echo 正在安装网页依赖，请保持网络连接。
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 长安漫游地址：http://127.0.0.1:5175/
echo 请保留这个窗口，关闭窗口将停止本地网页服务。
call npm run dev -- --open
pause
