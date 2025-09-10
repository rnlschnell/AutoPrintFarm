#!/bin/bash

# Bambu Program One-Command Deployment Script
# Usage: ./deploy-to-pi.sh [pi@PI_IP] [--no-reboot]

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PI_USER="pi"
PI_IP=""
NO_REBOOT=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

show_usage() {
    echo "Usage: $0 [pi@PI_IP] [--no-reboot]"
    echo
    echo "Arguments:"
    echo "  pi@PI_IP      SSH connection string (e.g., pi@192.168.1.50)"
    echo "  --no-reboot   Skip the reboot after deployment"
    echo
    echo "Examples:"
    echo "  $0 pi@192.168.1.50"
    echo "  $0 pi@192.168.1.50 --no-reboot"
    echo
    echo "This script will:"
    echo "  1. Copy bambu-program to your Pi"
    echo "  2. Set up auto-installation service"
    echo "  3. Reboot the Pi (auto-install will run on boot)"
    echo "  4. Your API will be available at http://PI_IP:8080/docs"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-reboot)
            NO_REBOOT=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            if [[ -z "$PI_IP" ]]; then
                PI_IP="$1"
            else
                error "Unknown argument: $1"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate PI_IP
if [[ -z "$PI_IP" ]]; then
    error "PI_IP is required"
    show_usage
    exit 1
fi

# Validate SSH connection format
if [[ ! "$PI_IP" =~ ^[a-zA-Z0-9_]+@[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    error "Invalid SSH connection format. Use: pi@192.168.1.50"
    show_usage
    exit 1
fi

# Extract just the IP part
IP_ONLY="${PI_IP#*@}"

# Banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                Bambu Program Pi Deployment                    ║"
echo "║                     One-Command Setup                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

log "Deploying to: $PI_IP"
log "Script directory: $SCRIPT_DIR"

# Verify required files exist
log "Verifying deployment files..."
REQUIRED_FILES=(
    "auto-install.sh"
    "bambu-auto-install.service"
    "install.sh"
    "requirements.txt"
    "src/main.py"
    "config/config.yaml"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        error "Required file not found: $file"
        exit 1
    fi
done

success "All required files present"

# Test SSH connection
log "Testing SSH connection to $PI_IP..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$PI_IP" "echo 'SSH connection successful'" >/dev/null 2>&1; then
    error "Cannot connect to $PI_IP via SSH"
    error "Please ensure:"
    error "  - Pi is powered on and connected to network"
    error "  - SSH is enabled on the Pi"
    error "  - You can connect manually: ssh $PI_IP"
    exit 1
fi

success "SSH connection successful"

# Copy bambu-program to Pi
log "Copying bambu-program to Pi..."
if scp -r "$SCRIPT_DIR" "$PI_IP:/home/pi/bambu-program-temp"; then
    success "Files copied successfully"
else
    error "Failed to copy files to Pi"
    exit 1
fi

# Set up auto-installation on Pi
log "Setting up auto-installation service..."
ssh "$PI_IP" << 'EOF'
    # Remove existing installation if present
    if [ -d "/home/pi/bambu-program" ]; then
        echo "Removing existing bambu-program installation..."
        sudo systemctl stop bambu-program.service 2>/dev/null || true
        sudo systemctl disable bambu-program.service 2>/dev/null || true
        sudo rm -f /etc/systemd/system/bambu-program.service
        sudo rm -rf /home/pi/bambu-program
    fi
    
    # Move temp directory to final location
    mv /home/pi/bambu-program-temp /home/pi/bambu-program
    
    # Make scripts executable
    chmod +x /home/pi/bambu-program/auto-install.sh
    chmod +x /home/pi/bambu-program/install.sh
    
    # Install and enable auto-install service
    sudo cp /home/pi/bambu-program/bambu-auto-install.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable bambu-auto-install.service
    
    echo "Auto-installation service set up successfully"
EOF

success "Auto-installation service configured"

# Final instructions
echo
success "Deployment completed successfully!"
echo
echo -e "${BLUE}What happens next:${NC}"
echo "1. Auto-install service is enabled and will run on next boot"
echo "2. On boot, the service will automatically install bambu-program"
echo "3. The API service will start automatically"
echo "4. You can access the API at: http://$IP_ONLY:8080/docs"
echo

if [[ "$NO_REBOOT" == "true" ]]; then
    warn "Skipping reboot (--no-reboot flag used)"
    echo
    echo -e "${YELLOW}To complete installation, run:${NC}"
    echo "  ssh $PI_IP 'sudo reboot'"
    echo
    echo -e "${YELLOW}Or trigger auto-install manually:${NC}"
    echo "  ssh $PI_IP 'cd /home/pi/bambu-program && ./auto-install.sh'"
else
    log "Rebooting Pi to trigger auto-installation..."
    ssh "$PI_IP" "sudo reboot" || true
    
    echo
    echo -e "${GREEN}Pi is rebooting...${NC}"
    echo
    echo "Auto-installation will run on boot. This may take 2-3 minutes."
    echo
    echo -e "${BLUE}You can monitor progress by:${NC}"
    echo "1. Wait ~30 seconds for Pi to boot"
    echo "2. SSH back in: ssh $PI_IP"
    echo "3. Check logs: sudo journalctl -u bambu-auto-install -f"
    echo "4. Check service: sudo systemctl status bambu-program"
    echo
    echo -e "${GREEN}When complete, access your API at: http://$IP_ONLY:8080/docs${NC}"
fi

echo
echo -e "${BLUE}Configuration:${NC}"
echo "• Edit printer settings: /home/pi/bambu-program/config/printers.yaml"
echo "• View logs: sudo journalctl -u bambu-program -f"
echo "• Service commands: sudo systemctl [start|stop|restart|status] bambu-program"
echo

success "Deployment complete! 🚀"