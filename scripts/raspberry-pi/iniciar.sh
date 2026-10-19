#!/bin/sh
# Started by the desktop (~/.config/labwc/autostart, see instalar.sh): finds the library,
# keeps `tv-gominho servir` running and opens Chromium full screen on it.

here="$(cd "$(dirname "$0")/.." && pwd)"
port=8080
log="$HOME/.cache/tv-gominho.log"
mkdir -p "$(dirname "$log")"
BIBLIOTECA=""
[ -f "$HOME/.config/tv-gominho.conf" ] && . "$HOME/.config/tv-gominho.conf"

find_library() {
  if [ -n "$BIBLIOTECA" ]; then
    [ -d "$BIBLIOTECA" ] && echo "$BIBLIOTECA"
    return
  fi
  for dir in "$HOME/biblioteca" /media/"$USER"/*/biblioteca /media/"$USER"/*; do
    if [ -d "$dir/programas" ]; then echo "$dir"; return; fi
  done
}

# USB sticks are mounted a few seconds after the desktop starts: wait up to 2 minutes.
library=""
for _ in $(seq 60); do
  library="$(find_library)"
  [ -n "$library" ] && break
  sleep 2
done
if [ -z "$library" ]; then
  echo "$(date): nenhuma biblioteca encontrada" >> "$log"
  exit 1
fi

# The server, restarted if it ever stops.
(
  while true; do
    node "$here/tv-gominho.mjs" servir "$library" --porta "$port" >> "$log" 2>&1
    sleep 3
  done
) &

for _ in $(seq 30); do
  node -e "fetch('http://127.0.0.1:$port/__biblioteca/lista',{method:'HEAD'}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
  sleep 1
done

browser="$(command -v chromium || command -v chromium-browser)"
exec "$browser" "http://localhost:$port/" \
  --kiosk --noerrdialogs --disable-infobars --no-first-run --start-maximized \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble --check-for-update-interval=31536000 \
  --password-store=basic
