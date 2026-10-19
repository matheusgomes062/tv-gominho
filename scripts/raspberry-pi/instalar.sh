#!/bin/bash
# Turns a Raspberry Pi (Raspberry Pi OS with desktop, Bookworm or newer) into a TV Gominho
# box: it boots straight into the channel, full screen, with the library from a USB stick
# or a folder. Run it from the portable package (npm run pacote), as the normal user:
#
#   bash raspberry-pi/instalar.sh [pasta-da-biblioteca]
#
# Without a folder, the library is looked for at every boot: ~/biblioteca, then any USB
# stick with a "biblioteca" folder (or with programas/ at its root).
# Undo: bash ~/tv-gominho/raspberry-pi/desinstalar.sh
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then echo "Este script é para o Raspberry Pi (Linux)."; exit 1; fi
if [ "$(id -u)" -eq 0 ]; then echo "Rode como o usuário normal (sem sudo); ele pede a senha quando precisar."; exit 1; fi

package="$(cd "$(dirname "$0")/.." && pwd)"
target="$HOME/tv-gominho"
config="$HOME/.config/tv-gominho.conf"
autostart="$HOME/.config/labwc/autostart"
marker="# tv-gominho"

[ -f "$package/tv-gominho.mjs" ] || { echo "Rode a partir da pasta do pacote (a que tem tv-gominho.mjs)."; exit 1; }

# ---- Node.js 20 or newer (the tool and the server)
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  echo "Instalando o Node.js pelo apt..."
  sudo apt-get update -qq && sudo apt-get install -y -qq nodejs || true
fi
if [ "$(node_major)" -lt 20 ]; then
  echo "O Node.js do sistema é antigo ($(node -v 2>/dev/null || echo nenhum)); a TV Gominho precisa do 20 ou mais novo."
  echo "Instale o 22 pelo NodeSource e rode este script de novo:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs"
  exit 1
fi
command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 || sudo apt-get install -y -qq chromium

# ---- the package, in a fixed place (the stick may not be there at boot)
if [ "$package" != "$target" ]; then
  rm -rf "$target"
  cp -r "$package" "$target"
fi
chmod +x "$target/raspberry-pi/"*.sh

# ---- where the library is
mkdir -p "$(dirname "$config")"
if [ $# -ge 1 ]; then
  library="$(cd "$1" && pwd)"
  printf 'BIBLIOTECA=%q\n' "$library" > "$config"
  echo "Biblioteca: $library"
else
  : > "$config"
  echo "Biblioteca: procurada a cada vez que o Pi liga (~/biblioteca ou um pendrive com a pasta biblioteca)."
fi

# ---- start with the desktop (labwc), once
mkdir -p "$(dirname "$autostart")"
touch "$autostart"
if ! grep -q "$marker" "$autostart"; then
  printf '%s\n%s &\n' "$marker" "$target/raspberry-pi/iniciar.sh" >> "$autostart"
fi

# ---- boot into the desktop with automatic login, and never blank the screen
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_boot_behaviour B4 || echo "Aviso: não consegui ligar o login automático (raspi-config, System Options)."
  sudo raspi-config nonint do_blanking 1 || echo "Aviso: não consegui desligar o descanso de tela (raspi-config, Display Options)."
else
  echo "Aviso: sem raspi-config. Ligue o login automático no desktop e desligue o descanso de tela."
fi

echo
echo "Pronto. Reinicie (sudo reboot): o Pi vai ligar direto na TV Gominho."
echo "Para sair da tela cheia: Alt+F4. Para desfazer: bash $target/raspberry-pi/desinstalar.sh"
