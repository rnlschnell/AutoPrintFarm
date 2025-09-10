#!/bin/bash

# Bambu Program File Verification Script
# Run this before copying to Pi to ensure all files are present

echo "🔍 Verifying all required files are present..."

# Critical files that must exist
CRITICAL_FILES=(
    "requirements.txt"
    "src/main.py"
    "src/core/printer_client.py"
    "src/api/printers.py"
    "bambu-program.service"
    "start_service.sh"
    "install.sh"
    "config/config.yaml"
    "config/printers.yaml"
)

MISSING_FILES=()

# Check each file
for file in "${CRITICAL_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        MISSING_FILES+=("$file")
        echo "❌ MISSING: $file"
    else
        echo "✅ Found: $file"
    fi
done

# Check if requirements.txt has content
if [ -f "requirements.txt" ]; then
    if [ ! -s "requirements.txt" ]; then
        echo "⚠️  WARNING: requirements.txt is empty"
    else
        echo "✅ requirements.txt has content ($(wc -l < requirements.txt) lines)"
    fi
fi

# Report results
echo
if [ ${#MISSING_FILES[@]} -eq 0 ]; then
    echo "🎉 ALL FILES VERIFIED - Ready for deployment!"
    echo
    echo "Next steps:"
    echo "1. Copy to Pi: scp -r bambu-program pi@PI_IP:/home/pi/"
    echo "2. SSH to Pi: ssh pi@PI_IP"
    echo "3. Run installer: cd bambu-program && chmod +x install.sh && ./install.sh"
else
    echo "❌ MISSING FILES DETECTED:"
    for file in "${MISSING_FILES[@]}"; do
        echo "   - $file"
    done
    echo
    echo "Please ensure all files are present before copying to Pi."
    exit 1
fi