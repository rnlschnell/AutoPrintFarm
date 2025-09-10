#!/bin/bash

# Pi Installation Script for Print Farm Software
# This script sets up the print farm software on a fresh Raspberry Pi OS Lite installation

set -e

echo "=== Print Farm Software Installation Script ==="
echo "Installing on Raspberry Pi at $(hostname -I | awk '{print $1}')"

# Update system
echo "1. Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install system dependencies
echo "2. Installing system dependencies..."
sudo apt install -y python3 python3-pip python3-venv git nginx nodejs npm

# Clone repository
echo "3. Cloning repository (development branch)..."
cd /home/pi
if [ -d "PrintFarmSoftware" ]; then
    echo "Repository already exists, pulling latest changes..."
    cd PrintFarmSoftware
    git fetch --all
    git checkout development
    git pull origin development
else
    git clone -b development https://github.com/rnlschnell/PrintFarmSoftware.git
    cd PrintFarmSoftware
fi

# Create Python virtual environment
echo "4. Setting up Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
echo "5. Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Build frontend
echo "6. Building frontend..."
cd frontend
npm install --legacy-peer-deps
npm run build
cd ..

# Create systemd service
echo "7. Creating systemd service..."
sudo cp bambu-program.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bambu-program.service

# Create log directory
echo "8. Creating log directory..."
sudo mkdir -p /var/log/bambu-program
sudo chown pi:pi /var/log/bambu-program

# Start the service
echo "9. Starting the service..."
sudo systemctl start bambu-program.service

# Check service status
echo "10. Checking service status..."
sudo systemctl status bambu-program.service --no-pager

echo ""
echo "=== Installation Complete ==="
echo "The Print Farm Software is now running at http://$(hostname -I | awk '{print $1}'):8080"
echo ""
echo "To view logs: sudo journalctl -u bambu-program -f"
echo "To restart: sudo systemctl restart bambu-program"
echo "To stop: sudo systemctl stop bambu-program"