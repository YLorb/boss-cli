@echo off
rem ============================================================
rem  boss-cli 持久化 Chrome 启动器
rem  固定 user-data-dir + 固定远程调试端口，登录态跨会话复用
rem  用法: 双击本文件，或 chrome-persist.bat
rem ============================================================
setlocal

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILE=%USERPROFILE%\.boss-cli\.cache\browser-data"
set "PORT=53470"
set "START_URL=https://www.zhipin.com/web/chat/index"

if not exist "%CHROME%" (
  echo [chrome-persist] ERROR: chrome.exe not found at %CHROME%
  exit /b 1
)

rem 端口已就绪则直接复用，避免重复拉起触发 Chrome 单例锁
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [chrome-persist] port %PORT% already listening - reuse running instance.
  exit /b 0
)

start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=%PORT% --no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble --restore-last-session "%START_URL%"

echo [chrome-persist] launched: profile=%PROFILE% port=%PORT%
exit /b 0
