# Bambu Program - Complete API Control System

## System Overview

A lightweight Raspberry Pi application providing a complete REST API for controlling all Bambu Lab 3D printer models. Access the interactive API documentation at `http://192.168.4.45:8080/docs` for testing all commands.

## Critical Documentation Reference

**MANDATORY**: All implementation must strictly follow the official Bambu Lab API documentation: https://bambutools.github.io/bambulabs_api/index.html

## Supported Printer Models

- **X1 Series**: X1, X1 Carbon, X1E
- **P1 Series**: P1P, P1S  
- **A1 Series**: A1, A1 mini
- **All Future Models**: Compatible with any printer using Bambu Lab's MQTT protocol

## Architecture

```
Client → FastAPI (with /docs) → bambulabs_api → MQTT → Bambu Printer
```

## Installation

### 🍓 Raspberry Pi OS Lite (Production)
```bash
# One-command installation
chmod +x install.sh && ./install.sh

# Configure printers, then start service
sudo systemctl start bambu-program

# Access API at http://YOUR_PI_IP:8080/docs
```

### 💻 Development/Testing
```bash
# 1. Install system dependencies
sudo apt update && sudo apt install python3 python3-pip python3-venv -y

# 2. Create and setup application
mkdir bambu-program && cd bambu-program
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Configure printers in config/printers.yaml

# 4. Run the application
python src/main.py

# 5. Access API documentation at http://localhost:8080/docs
```

📖 **Complete Pi installation guide**: [PI_INSTALLATION.md](PI_INSTALLATION.md)

## Success Criteria

1. **Interactive API Testing**: `/docs` endpoint provides full Swagger UI for testing all commands
2. **Complete Command Coverage**: All available Bambu Lab commands implemented
3. **Model Compatibility**: Works with all current Bambu printer models
4. **File Handling**: Proper 3MF and G-code upload/management per Bambu specifications
5. **Reliable Operation**: Stable connections and command execution

This specification focuses purely on delivering a complete, testable API that covers all Bambu Lab printer functionality through the built-in FastAPI documentation interface.