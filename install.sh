#!/bin/bash

# Bambu Program Installation Script for Raspberry Pi OS Lite
# Usage: ./install.sh [--yes|-y] [--auto]

set -e  # Exit on any error

# Parse command line arguments
AUTO_INSTALL=false
SKIP_PROMPTS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -y|--yes)
            SKIP_PROMPTS=true
            shift
            ;;
        --auto)
            AUTO_INSTALL=true
            SKIP_PROMPTS=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  -y, --yes     Skip all prompts and use defaults"
            echo "  --auto        Run in auto-install mode (for boot service)"
            echo "  -h, --help    Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Check for environment variable override
if [[ "${BAMBU_AUTO_INSTALL:-}" == "1" ]]; then
    AUTO_INSTALL=true
    SKIP_PROMPTS=true
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
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

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root. Please run as the pi user."
   exit 1
fi

# Banner
if [[ "$AUTO_INSTALL" == "true" ]]; then
    log "Starting Bambu Program Auto-Installation..."
else
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║               Bambu Program Installation Script               ║"
    echo "║               For Raspberry Pi OS Lite                       ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
fi

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    warn "This script is designed for Raspberry Pi. Continuing anyway..."
fi

# Get the current directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Script running from: $SCRIPT_DIR"

# Update system packages
log "Updating system packages..."
sudo apt update -y
success "System packages updated"

# Install system dependencies
log "Installing system dependencies..."
sudo apt install -y python3 python3-pip python3-venv git curl

# Check Python version
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)

# Check if Python version is >= 3.8
if [[ $PYTHON_MAJOR -lt 3 ]] || [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -lt 8 ]]; then
    error "Python 3.8 or higher is required. Found: $PYTHON_VERSION"
    exit 1
fi
success "Python $PYTHON_VERSION detected"

# Set up directory
INSTALL_DIR="/home/pi/bambu-program"
log "Setting up application directory at $INSTALL_DIR"

# If directory exists, ask for permission to overwrite
if [ -d "$INSTALL_DIR" ]; then
    warn "Directory $INSTALL_DIR already exists."
    
    if [[ "$SKIP_PROMPTS" == "true" ]]; then
        log "Auto-install mode: Overwriting existing directory..."
        response="y"
    else
        echo -n "Do you want to overwrite it? (y/N): "
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            error "Installation cancelled by user"
            exit 1
        fi
    fi
    
    # If we're running from the target directory, we need to handle this carefully
    if [[ "$PWD" == "$INSTALL_DIR"* ]]; then
        log "Script is running from target directory, using safe removal method..."
        # Create a temporary directory for the script
        TEMP_SCRIPT_DIR="/tmp/bambu-program-install-$$"
        mkdir -p "$TEMP_SCRIPT_DIR"
        
        # Copy script directory to temp location first
        if command -v rsync >/dev/null 2>&1; then
            rsync -av --exclude='*.pyc' --exclude='__pycache__' --exclude='.git' "$SCRIPT_DIR/" "$TEMP_SCRIPT_DIR/"
        else
            cp -r "$SCRIPT_DIR"/* "$TEMP_SCRIPT_DIR/" 2>/dev/null || {
                error "Failed to copy files to temporary location"
                exit 1
            }
        fi
        
        # Update script directory reference
        SCRIPT_DIR="$TEMP_SCRIPT_DIR"
        
        # Now we can safely remove the target directory
        cd /home/pi
        rm -rf "$INSTALL_DIR"
    else
        rm -rf "$INSTALL_DIR"
    fi
fi

# Create installation directory
log "Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Copy files from script directory to installation directory
log "Copying application files..."
# Use rsync for reliable copying, fall back to cp if rsync not available
if command -v rsync >/dev/null 2>&1; then
    rsync -av --exclude='*.pyc' --exclude='__pycache__' --exclude='.git' "$SCRIPT_DIR/" "$INSTALL_DIR/"
else
    # Fallback to cp with better error handling
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || {
        error "Failed to copy files"
        exit 1
    }
    # Copy hidden files separately
    if ls "$SCRIPT_DIR"/.[!.]* 1> /dev/null 2>&1; then
        cp -r "$SCRIPT_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
    fi
fi

# Clean up temporary directory if used
if [[ -n "$TEMP_SCRIPT_DIR" && -d "$TEMP_SCRIPT_DIR" ]]; then
    rm -rf "$TEMP_SCRIPT_DIR"
fi

# Change to installation directory
cd "$INSTALL_DIR"

# Verify critical files exist
log "Verifying critical files..."
CRITICAL_FILES=(
    "requirements.txt"
    "src/main.py"
    "src/core/printer_client.py"
    "src/api/printers.py"
    "bambu-program.service"
    "start_service.sh"
    "config/config.yaml"
    "config/printers.yaml"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        error "Critical file not found: $file"
        log "Current directory contents:"
        ls -la
        exit 1
    fi
done

# Create requirements.txt if it doesn't exist or is empty
if [ ! -s "requirements.txt" ]; then
    warn "requirements.txt is missing or empty, creating it..."
    cat > requirements.txt << 'EOF'
fastapi==0.104.1
uvicorn[standard]==0.24.0
bambulabs_api==2.6.3
pydantic==2.5.0
pyyaml==6.0.1
python-multipart==0.0.6
aiofiles==23.2.1
EOF
fi

success "Application files copied and verified"

# Create and activate virtual environment
log "Creating Python virtual environment..."
python3 -m venv venv
source venv/bin/activate
success "Virtual environment created"

# Upgrade pip
log "Upgrading pip..."
if ! pip install --upgrade pip; then
    error "Failed to upgrade pip"
    exit 1
fi

# Install Python dependencies
log "Installing Python dependencies..."
if [ ! -f "requirements.txt" ]; then
    error "requirements.txt not found in current directory: $(pwd)"
    ls -la
    exit 1
fi

log "Requirements.txt contents:"
cat requirements.txt

if ! pip install -r requirements.txt; then
    error "Failed to install Python dependencies"
    exit 1
fi
success "Python dependencies installed"

# Update configuration for Pi deployment
log "Updating configuration for Raspberry Pi deployment..."

# Get Pi's IP address
PI_IP=$(hostname -I | awk '{print $1}')
if [ -z "$PI_IP" ]; then
    PI_IP="0.0.0.0"
    warn "Could not detect Pi IP address, using 0.0.0.0"
else
    log "Detected Pi IP address: $PI_IP"
fi

# Ensure config.yaml exists and has correct content
cat > config/config.yaml << EOF
server:
  host: "0.0.0.0"  # Bind to all interfaces for network access
  port: 8080
  title: "Bambu Program API"
  description: "Complete Bambu Lab Printer Control API - Raspberry Pi"
  
# Production settings
production:
  cors_origins: ["*"]  # Configure specific origins for security in production
  log_level: "info"
  max_connections: 100
  timeout: 30

# Raspberry Pi optimizations
hardware:
  memory_limit: "512M"
  worker_connections: 50
  keep_alive: 60
EOF

success "Configuration updated for Pi deployment"

# Set up systemd service
log "Installing systemd service..."
sudo cp bambu-program.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bambu-program.service
success "Systemd service installed and enabled"

# Set proper permissions
log "Setting file permissions..."
chmod +x install.sh
chmod +x start_service.sh
chmod 644 bambu-program.service
chown -R pi:pi "$INSTALL_DIR"

# Create logs directory
mkdir -p logs
success "Permissions and directories set up"

# Configuration validation
log "Validating configuration..."
if [ ! -f "config/printers.yaml" ]; then
    warn "No printers configured. Please edit config/printers.yaml before starting the service."
else
    success "Printer configuration found"
fi

# Test import
log "Testing Python imports..."
source venv/bin/activate
if python3 -c "import src.main" 2>/dev/null; then
    success "Python imports successful"
else
    error "Python import test failed. Please check the installation."
    exit 1
fi

# Final instructions
echo
success "Installation completed successfully!"

if [[ "$AUTO_INSTALL" == "true" ]]; then
    log "Auto-installation complete. Service will start automatically."
    log "API will be available at: http://$PI_IP:8080/docs"
    log "Configure printers in: $INSTALL_DIR/config/printers.yaml"
else
    echo
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Configure your printers in: $INSTALL_DIR/config/printers.yaml"
    echo "2. Start the service: sudo systemctl start bambu-program"
    echo "3. Check status: sudo systemctl status bambu-program"
    echo "4. View logs: sudo journalctl -u bambu-program -f"
    echo "5. Access API documentation: http://$PI_IP:8080/docs"
    echo
    echo -e "${BLUE}Service management commands:${NC}"
    echo "• Start:   sudo systemctl start bambu-program"
    echo "• Stop:    sudo systemctl stop bambu-program"
    echo "• Restart: sudo systemctl restart bambu-program"
    echo "• Status:  sudo systemctl status bambu-program"
    echo "• Logs:    sudo journalctl -u bambu-program -f"
fi

n# Setup OrcaSlicer for 3MF slicing
echo -e "Setting up OrcaSlicer for 3MF slicing..."
if ./setup_orcaslicer.sh; then
    echo -e "✅ OrcaSlicer setup completed successfully"
else
    echo -e "⚠️ OrcaSlicer setup encountered issues - slicing may not work"
    echo -e "Run ./setup_orcaslicer.sh manually to fix"
fi

echo
echo -e "${GREEN}Installation complete! The service will start automatically on boot.${NC}"