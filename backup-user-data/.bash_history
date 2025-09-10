if [ -d "/home/pi/bambu-program" ]; then       sudo systemctl stop bambu-program.service 2>/dev/null || true;       sudo systemctl disable bambu-program.service 2>/dev/null || true;       sudo rm -f /etc/systemd/system/bambu-program.service;       sudo rm -rf /home/pi/bambu-program;   fi
chmod +x /home/pi/bambu-program/auto-install.sh
sudo cp /home/pi/bambu-program/bambu-auto-install.service /etc/systemd/system/
