#!/bin/bash
# Automated Pi Restore Script
# This script restores the complete bambu-program system to a fresh Raspberry Pi

set -e  # Exit on any error

echo "=== Bambu Program Restore Script ==="
echo "This will restore the complete 3D print controller system"
echo "Make sure you're running this on a fresh Raspberry Pi"
echo ""

# Check if running as pi user
if [ "$USER" != "pi" ]; then
    echo "ERROR: This script must be run as the 'pi' user"
    exit 1
fi

# Update system
echo "Step 1: Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install system dependencies
echo "Step 2: Installing system dependencies..."
sudo apt install -y python3-pip python3-venv git docker.io flatpak

# Add pi user to docker group
sudo usermod -aG docker pi

# Create main application directory
echo "Step 3: Setting up application directory..."
cd /home/pi
if [ ! -d "bambu-program" ]; then
    mkdir bambu-program
fi

# Copy application files
echo "Step 4: Copying application files..."
cp -r src venv config logs orcaslicer-profiles requirements.txt README.md *.py *.sh *.service *.json /home/pi/bambu-program/

# Set up Python virtual environment
echo "Step 5: Setting up Python virtual environment..."
cd /home/pi/bambu-program
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Install systemd service
echo "Step 6: Installing systemd service..."
sudo cp bambu-program.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bambu-program

# Restore user configuration files
echo "Step 7: Restoring user configuration..."
if [ -d "backup-user-data" ]; then
    cp backup-user-data/.bashrc ~/.bashrc 2>/dev/null || true
    cp backup-user-data/.profile ~/.profile 2>/dev/null || true
    cp backup-user-data/*.3mf ~/ 2>/dev/null || true
    cp backup-user-data/*.json ~/ 2>/dev/null || true
    cp backup-user-data/*.py ~/ 2>/dev/null || true
    cp -r backup-user-data/test_files ~/ 2>/dev/null || true
    cp -r backup-user-data/gcode_output ~/ 2>/dev/null || true
fi

# Set up OrcaSlicer
echo "Step 8: Setting up OrcaSlicer..."
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub io.github.softfever.OrcaSlicer || true

# Set permissions
echo "Step 9: Setting file permissions..."
chmod +x /home/pi/bambu-program/*.sh
chmod +x /home/pi/bambu-program/*.py

# Create log directory if it doesn't exist
mkdir -p /home/pi/bambu-program/logs

# Start the service
echo "Step 10: Starting bambu-program service..."
sudo systemctl start bambu-program

# Wait a moment for service to start
sleep 5

# Check service status
echo "Step 11: Verifying installation..."
if sudo systemctl is-active --quiet bambu-program; then
    echo "✅ Service is running successfully!"
    echo "✅ API should be available at: http://$(hostname -I | awk '{print $1}'):8080/docs"
else
    echo "❌ Service failed to start. Checking logs..."
    sudo journalctl -u bambu-program --no-pager -n 20
    exit 1
fi

# Display final status
echo ""
echo "=== Restore Complete ==="
echo "Service Status: $(sudo systemctl is-active bambu-program)"
echo "API Endpoint: http://$(hostname -I | awk '{print $1}'):8080/docs"
echo "Logs: tail -f /home/pi/bambu-program/logs/service.log"
echo ""
echo "To check service status: sudo systemctl status bambu-program"
echo "To restart service: sudo systemctl restart bambu-program"
echo "To view logs: sudo journalctl -u bambu-program -f"
echo ""
echo "🎉 Bambu Program has been successfully restored!"