# Complete Pi Restore Guide

This guide provides step-by-step instructions to restore the complete 3D print controller system on a fresh Raspberry Pi.

## System Overview

- **Primary Application**: Bambu 3D Print Controller
- **Technology Stack**: Python FastAPI, Uvicorn, systemd
- **API Endpoint**: http://192.168.4.45:8080/docs
- **Main Directory**: `/home/pi/bambu-program/`
- **Service**: `bambu-program.service`

## Backup Contents

This backup contains:
1. **Application Code**: Complete bambu-program source code and dependencies
2. **User Data**: 3MF files, test files, configurations
3. **System Configuration**: systemd services, network settings
4. **Documentation**: Installed packages, system information

## Restore Instructions

### 1. Fresh Pi Setup
```bash
# Flash fresh Raspberry Pi OS to SD card
# Enable SSH during flash or via raspi-config
# Boot Pi and connect to network
```

### 2. Initial System Configuration
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required system packages (see backup-documentation/installed_packages.txt)
sudo apt install -y python3-pip python3-venv git docker.io

# Add pi user to docker group
sudo usermod -aG docker pi
```

### 3. Restore Application Files
```bash
# Create main directory
cd /home/pi
git clone https://github.com/rnlschnell/github-bambu-program.git
cd github-bambu-program
git checkout working-backup

# Copy application to correct location
cp -r * /home/pi/bambu-program/
cd /home/pi/bambu-program

# Set up Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Restore System Configuration
```bash
# Copy systemd service
sudo cp bambu-program.service /etc/systemd/system/

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable bambu-program
sudo systemctl start bambu-program

# Check service status
sudo systemctl status bambu-program
```

### 5. Restore User Data
```bash
# Copy user configuration files
cp backup-user-data/.bashrc ~/.bashrc
cp backup-user-data/.profile ~/.profile

# Restore 3MF files and test data
cp backup-user-data/*.3mf ~/
cp backup-user-data/*.json ~/
cp backup-user-data/*.py ~/
cp -r backup-user-data/test_files ~/
cp -r backup-user-data/gcode_output ~/
```

### 6. Set Up OrcaSlicer (if needed)
```bash
# Install flatpak OrcaSlicer
sudo apt install -y flatpak
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub io.github.softfever.OrcaSlicer

# Copy OrcaSlicer profiles
cp -r orcaslicer-profiles ~/
```

### 7. Network Configuration
```bash
# Restore network settings if needed
sudo cp backup-network-config/* /etc/network/

# Set static IP (if required)
# Edit /etc/dhcpcd.conf for static IP configuration
```

### 8. Verification
```bash
# Check service is running
sudo systemctl status bambu-program

# Test API endpoint
curl http://localhost:8080/docs

# Check logs
tail -f logs/service.log
```

## Important Notes

- **IP Address**: The original system used IP 192.168.4.45
- **Port**: Application runs on port 8080
- **Virtual Environment**: Python dependencies are in `/home/pi/bambu-program/venv/`
- **Logs**: Service logs are in `/home/pi/bambu-program/logs/`

## File Structure After Restore

```
/home/pi/bambu-program/
├── src/                    # Main application source
├── venv/                   # Python virtual environment
├── config/                 # Configuration files
├── logs/                   # Application logs
├── orcaslicer-profiles/    # OrcaSlicer configuration
├── bambu-program.service   # systemd service file
├── requirements.txt        # Python dependencies
├── README.md              # Original documentation
└── Various scripts and config files
```

## Troubleshooting

### Service Won't Start
```bash
# Check service logs
sudo journalctl -u bambu-program -f

# Check Python virtual environment
cd /home/pi/bambu-program
source venv/bin/activate
python -m uvicorn src.main:app --host 0.0.0.0 --port 8080
```

### Missing Dependencies
```bash
# Reinstall Python packages
cd /home/pi/bambu-program
source venv/bin/activate
pip install -r requirements.txt

# Check system packages
sudo apt install -y $(cat backup-documentation/installed_packages.txt | grep "^ii" | awk '{print $2}')
```

### Network Issues
```bash
# Check network configuration
ip addr show
ping 8.8.8.8

# Restore network settings if needed
sudo cp backup-network-config/* /etc/network/
sudo systemctl restart networking
```

## Backup Information

- **Backup Date**: $(date)
- **Original System**: Raspberry Pi running bambu-program
- **Application Size**: ~185MB
- **Total Files**: ~4,763 files
- **Service Status**: Running as systemd service

This backup is complete and should allow full restoration of the 3D print controller system.