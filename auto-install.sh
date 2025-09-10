#!/bin/bash

# Bambu Program Auto-Install Script
# Runs on boot to automatically install bambu-program if present

set -e  # Exit on any error

# Configuration
INSTALL_DIR="/home/pi/bambu-program"
LOG_FILE="/var/log/bambu-auto-install.log"
LOCK_FILE="/tmp/bambu-auto-install.lock"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | sudo tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | sudo tee -a "$LOG_FILE" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | sudo tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | sudo tee -a "$LOG_FILE"
}

# Check if already running
if [ -f "$LOCK_FILE" ]; then
    log "Auto-install already running or was interrupted. Removing lock file."
    rm -f "$LOCK_FILE"
fi

# Create lock file
touch "$LOCK_FILE"

# Cleanup on exit
cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

# Start logging
log "=== Bambu Program Auto-Install Starting ==="
log "Checking for bambu-program installation..."

# Check if bambu-program directory exists
if [ ! -d "$INSTALL_DIR" ]; then
    log "No bambu-program directory found at $INSTALL_DIR"
    log "Auto-install not needed. Exiting."
    exit 0
fi

# Check if already installed (service exists and is enabled)
if systemctl is-enabled bambu-program.service >/dev/null 2>&1; then
    log "Bambu-program service is already installed and enabled"
    log "Auto-install not needed. Exiting."
    exit 0
fi

log "Found bambu-program directory. Starting auto-installation..."

# Change to the install directory
cd "$INSTALL_DIR"

# Check if install script exists
if [ ! -f "install.sh" ]; then
    error "install.sh not found in $INSTALL_DIR"
    exit 1
fi

# Make install script executable
chmod +x install.sh

# Run the installation with auto-install flag
log "Running installation with auto-install mode..."
export BAMBU_AUTO_INSTALL=1

if ./install.sh --auto; then
    success "Bambu Program auto-installation completed successfully!"
    log "Service should now be running. Checking status..."
    
    # Give the service a moment to start
    sleep 5
    
    if systemctl is-active --quiet bambu-program.service; then
        success "Bambu Program service is running successfully"
        
        # Get Pi IP for user information
        PI_IP=$(hostname -I | awk '{print $1}')
        if [ -n "$PI_IP" ]; then
            log "API documentation available at: http://$PI_IP:8080/docs"
        fi
        
        log "=== Auto-installation completed successfully ==="
    else
        warn "Installation completed but service is not running"
        log "Check service status: sudo systemctl status bambu-program"
        log "Check logs: sudo journalctl -u bambu-program -f"
    fi
else
    error "Auto-installation failed. Check logs for details."
    exit 1
fi