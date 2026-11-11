#!/usr/bin/env bash
# ============================================================
#  boss-cli 持久化 Chrome 守护进程
#  固定 user-data-dir + 固定远程调试端口；进程死了自动重启
#  用法：作为后台任务运行（工具级 run_in_background），不要加 &
# ============================================================
set -u

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
PROFILE="$HOME/.boss-cli/.cache/browser-data"
PORT="${BOSS_BROWSER_REMOTE_DEBUGGING_PORT:-53470}"
START_URL="${BOSS_CHROME_START_URL:-https://www.zhipin.com/web/chat/index}"
LOG="$HOME/.boss-cli/logs/chrome-keeper.log"
INTERVAL="${BOSS_CHROME_KEEPER_INTERVAL:-5}"

mkdir -p "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && exec 3>&- && return 0
  return 1
}

if [ ! -x "$CHROME" ]; then
  log "FATAL chrome.exe not found: $CHROME"
  exit 1
fi

log "keeper start pid=$$ port=$PORT profile=$PROFILE"

while :; do
  if ! port_open; then
    log "port $PORT closed -> launching chrome"
    "$CHROME" \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port="$PORT" \
      --no-first-run \
      --no-default-browser-check \
      --disable-infobars \
      --disable-session-crashed-bubble \
      --restore-last-session \
      "$START_URL" >/dev/null 2>&1 &
    CHROME_BG_PID=$!
    # 等待端口起来，最多 30s
    for _ in $(seq 1 15); do
      sleep 2
      if port_open; then
        log "port $PORT up (chrome pid=$CHROME_BG_PID)"
        break
      fi
    done
    port_open || log "WARN port $PORT still closed after 30s"
  fi
  sleep "$INTERVAL"
done
