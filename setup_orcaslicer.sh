#!/bin/bash

# OrcaSlicer Setup Script for Bambu Program
# Installs OrcaSlicer with Flatpak and applies layer_gcode patches to all Bambu profiles

set -e

echo "🔧 Setting up OrcaSlicer for Bambu Program..."

# Install Flatpak if not present
if ! command -v flatpak &> /dev/null; then
    echo "📦 Installing Flatpak..."
    sudo apt update
    sudo apt install -y flatpak
    
    # Add Flathub repository
    sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
    echo "✅ Flatpak installed and configured"
else
    echo "✅ Flatpak already installed"
fi

# Install OrcaSlicer via Flatpak
if ! flatpak list | grep -q "io.github.softfever.OrcaSlicer"; then
    echo "🖨️ Installing OrcaSlicer..."
    flatpak install -y flathub io.github.softfever.OrcaSlicer
    echo "✅ OrcaSlicer installed"
else
    echo "✅ OrcaSlicer already installed"
fi

# Create OrcaSlicer config directory structure
ORCA_CONFIG="$HOME/.config/OrcaSlicer"
echo "📁 Setting up OrcaSlicer configuration directory..."
mkdir -p "$ORCA_CONFIG/profiles/BBL/machine"
mkdir -p "$ORCA_CONFIG/profiles/BBL/filament"
mkdir -p "$ORCA_CONFIG/profiles/BBL/process"

# Copy default profiles from Flatpak installation
ORCA_PROFILES="$HOME/.local/share/flatpak/app/io.github.softfever.OrcaSlicer/current/active/files/share/OrcaSlicer/profiles"
if [ -d "$ORCA_PROFILES" ]; then
    echo "📋 Copying default OrcaSlicer profiles..."
    cp -r "$ORCA_PROFILES/BBL"/* "$ORCA_CONFIG/profiles/BBL/"
    echo "✅ Default profiles copied"
else
    echo "⚠️ Warning: Default profiles not found, OrcaSlicer may need to be run once manually"
fi

# Apply layer_gcode patches to all Bambu machine profiles
echo "🔧 Applying layer_gcode patches to Bambu machine profiles..."

MACHINE_DIR="$ORCA_CONFIG/profiles/BBL/machine"
if [ -d "$MACHINE_DIR" ]; then
    PATCH_COUNT=0
    
    # Process all JSON files in machine directory
    for profile in "$MACHINE_DIR"/*.json; do
        if [ -f "$profile" ]; then
            # Check if layer_gcode already exists
            if ! grep -q '"layer_gcode"' "$profile"; then
                # Add layer_gcode field before change_filament_gcode
                sed -i 's/"change_filament_gcode":/"layer_gcode": "G92 E0",\n    "change_filament_gcode":/' "$profile"
                ((PATCH_COUNT++))
                echo "  ✅ Patched: $(basename "$profile")"
            else
                echo "  ⏭️ Already patched: $(basename "$profile")"
            fi
        fi
    done
    
    echo "✅ Applied layer_gcode patches to $PATCH_COUNT machine profiles"
else
    echo "❌ Error: Machine profiles directory not found"
    exit 1
fi

# Verify installation
echo "🔍 Verifying OrcaSlicer installation..."

# Test OrcaSlicer CLI access
if flatpak run io.github.softfever.OrcaSlicer --help &> /dev/null; then
    echo "✅ OrcaSlicer CLI accessible"
else
    echo "❌ Error: OrcaSlicer CLI not accessible"
    exit 1
fi

# Count patched profiles
PATCHED_PROFILES=$(grep -l '"layer_gcode": "G92 E0"' "$MACHINE_DIR"/*.json 2>/dev/null | wc -l)
echo "✅ Found $PATCHED_PROFILES machine profiles with layer_gcode patches"

# Create OrcaSlicer wrapper script for easier CLI access
echo "📝 Creating OrcaSlicer wrapper script..."
if sudo tee /usr/local/bin/orcaslicer > /dev/null 2>&1 << 'WRAPPER_EOF'
#!/bin/bash
# OrcaSlicer CLI Wrapper
exec flatpak run io.github.softfever.OrcaSlicer "$@"
WRAPPER_EOF
then
    sudo chmod +x /usr/local/bin/orcaslicer
    echo "✅ System-wide wrapper created at /usr/local/bin/orcaslicer"
else
    echo "⚠️ Could not create system-wide wrapper, creating local wrapper..."
    mkdir -p "$HOME/bin"
    cat > "$HOME/bin/orcaslicer" << 'WRAPPER_EOF'
#!/bin/bash
# OrcaSlicer CLI Wrapper
exec flatpak run io.github.softfever.OrcaSlicer "$@"
WRAPPER_EOF
    chmod +x "$HOME/bin/orcaslicer"
    echo "✅ Local wrapper created at $HOME/bin/orcaslicer"
fi

echo "🎉 OrcaSlicer setup complete!"
echo ""
echo "📋 Summary:"
echo "  • OrcaSlicer installed via Flatpak"
echo "  • $PATCHED_PROFILES Bambu machine profiles patched with layer_gcode"
echo "  • CLI wrapper available"
echo "  • Ready for 3MF slicing with absolute extrusion mode"
echo ""
echo "🧪 Test command: orcaslicer --help"
echo ""