@echo off
setlocal
cd /d "%~dp0" || exit /b 1

where node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found on PATH.
    pause
    exit /b 1
)

if not exist "%~dp0dist\cli\index.js" (
    echo Build the local CLI before starting this launcher.
    echo Run npm run build from the repository directory.
    pause
    exit /b 1
)

set "BOSS_APP_HOME=%~dp0output\test-cdp"
set "BOSS_RUNS_DIR=%BOSS_APP_HOME%\runs"
set "BOSS_AGENT_SKILLS_DIR=%BOSS_APP_HOME%\agent-skills"
set "BOSS_SKILL_DIR=%~dp0skills\boss-recruitment"
set "BOSS_BROWSER_USER_DATA_DIR=%BOSS_APP_HOME%\browser-data"
set "BOSS_BROWSER_PROFILE_DIRECTORY=Default"
set "BOSS_BROWSER_REMOTE_DEBUGGING_PORT=53471"
set "BOSS_BROWSER_HEADLESS=false"

echo Starting the test Chrome session on 127.0.0.1:%BOSS_BROWSER_REMOTE_DEBUGGING_PORT%.
echo Wait for the ready receipt and keep this window open.
echo Close the test Chrome window to finish.
node.exe "%~dp0dist\cli\index.js" browser-session --json
set "SESSION_EXIT=%ERRORLEVEL%"

if not "%SESSION_EXIT%"=="0" (
    echo The test session ended with exit code %SESSION_EXIT%.
    pause
)
exit /b %SESSION_EXIT%
