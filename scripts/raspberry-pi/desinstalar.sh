#!/bin/sh
# Undoes instalar.sh: the Pi stops opening TV Gominho at boot. Login and screen
# blanking settings stay as they are (raspi-config changes them back).
autostart="$HOME/.config/labwc/autostart"
if [ -f "$autostart" ]; then
  # Removes the marker line and the line after it.
  sed -i '/^# tv-gominho$/,+1d' "$autostart"
fi
rm -f "$HOME/.config/tv-gominho.conf"
echo "Pronto: a TV Gominho não abre mais sozinha. A pasta ~/tv-gominho pode ser apagada."
