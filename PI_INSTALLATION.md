# Raspberry Pi Installation Guide

## Quick Installation (Recommended)

### One-Command Setup
```bash
# Download and run the automated installer
curl -sSL https://raw.githubusercontent.com/your-repo/bambu-program/main/install.sh | bash

# OR if you already have the files:
chmod +x install.sh && ./install.sh
```

## Manual Installation

### Prerequisites
- Raspberry Pi 3B+ or newer
- Raspberry Pi OS Lite (recommended for headless operation)
- 8GB+ SD card
- Network connection
- SSH access enabled

### Step-by-Step Installation

1. **Update the system**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Install dependencies**
   ```bash
   sudo apt install python3 python3-pip python3-venv git curl -y
   ```

3. **Clone/copy the application**
   ```bash
   cd /home/pi
   # Copy your bambu-program folder here
   cd bambu-program
   ```

4. **Run the installer**
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

## Configuration

### 1. Configure Your Printers
Edit the printer configuration file:
```bash
nano /home/pi/bambu-program/config/printers.yaml
```

Example configuration:
```yaml
printers:
  - id: "x1c_main"
    name: "X1 Carbon Main"
    ip: "192.168.1.100"           # Your printer's IP address
    access_code: "12345678"       # 8-digit code from printer settings
    serial: "AC12309BH109"        # Serial number from printer
    model: "X1C"                  # Printer model
```

### 2. Find Your Printer Information

**IP Address**: Check your router's DHCP client list or use Bambu Studio
**Access Code**: Printer Settings → Network → Access Code (8 digits)
**Serial Number**: Printer Settings → About or check Bambu Studio

## Service Management

### Start the Service
```bash
sudo systemctl start bambu-program
```

### Check Status
```bash
sudo systemctl status bambu-program
```

### View Live Logs
```bash
sudo journalctl -u bambu-program -f
```

### Auto-start on Boot (enabled by default)
```bash
sudo systemctl enable bambu-program
```

## Accessing the API

### Find Your Pi's IP Address
```bash
hostname -I
```

### Access Points
- **API Documentation**: `http://YOUR_PI_IP:8080/docs`
- **Health Check**: `http://YOUR_PI_IP:8080/health`
- **Alternative Docs**: `http://YOUR_PI_IP:8080/redoc`

Example: `http://192.168.1.50:8080/docs`

## Troubleshooting

### Service Won't Start
```bash
# Check detailed logs
sudo journalctl -u bambu-program -n 50

# Check configuration
nano /home/pi/bambu-program/config/printers.yaml

# Test manually
cd /home/pi/bambu-program
source venv/bin/activate
python src/main.py
```

### Can't Connect to Printer
1. Verify printer IP address is correct
2. Check access code (8 digits from printer settings)
3. Ensure printer is on the same network
4. Verify serial number matches exactly

### Port Already in Use
```bash
# Change port in config
nano /home/pi/bambu-program/config/config.yaml

# Restart service
sudo systemctl restart bambu-program
```

### Low Memory Issues
```bash
# Monitor memory usage
free -h

# Check service memory
sudo systemctl status bambu-program

# Restart if needed
sudo systemctl restart bambu-program
```

## Performance Optimization for Pi

### For Raspberry Pi 3B/3B+
- Set `worker_connections: 25` in config.yaml
- Monitor CPU usage with `htop`
- Consider using Pi 4 for multiple printers

### For Raspberry Pi 4+
- Default settings should work well
- Can handle multiple printer connections
- Monitor with `htop` and `journalctl`

## Network Configuration

### Static IP (Recommended)
Edit `/etc/dhcpcd.conf`:
```bash
sudo nano /etc/dhcpcd.conf
```

Add at the end:
```
interface wlan0
static ip_address=192.168.1.50/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8
```

### Firewall (Optional)
```bash
# Install ufw
sudo apt install ufw

# Allow SSH and API
sudo ufw allow ssh
sudo ufw allow 8080

# Enable firewall
sudo ufw enable
```

## Updating the Application

```bash
# Stop service
sudo systemctl stop bambu-program

# Update files (replace with your update method)
cd /home/pi/bambu-program
# Copy new files here

# Reinstall dependencies if needed
source venv/bin/activate
pip install -r requirements.txt

# Restart service
sudo systemctl start bambu-program
```

## Complete Uninstall

```bash
# Stop and disable service
sudo systemctl stop bambu-program
sudo systemctl disable bambu-program

# Remove service file
sudo rm /etc/systemd/system/bambu-program.service
sudo systemctl daemon-reload

# Remove application
rm -rf /home/pi/bambu-program
```

## Support

For issues specific to Raspberry Pi deployment:
1. Check service logs: `sudo journalctl -u bambu-program -f`
2. Verify network connectivity to printers
3. Ensure sufficient power supply (especially Pi 3B+)
4. Check SD card health if experiencing random issues