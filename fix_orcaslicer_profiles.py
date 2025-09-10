#!/usr/bin/env python3
"""
Fix OrcaSlicer Bambu Lab profiles to include G92 E0 in layer_change_gcode

This script adds G92 E0 ;[layer_z] to the layer_change_gcode field in all
Bambu Lab profiles that have the problematic simplified version, ensuring
they match the working desktop configuration.
"""

import json
import os
import sys
import glob
from pathlib import Path
import shutil
from datetime import datetime

# Expected layer_change_gcode with G92 E0 fix
FIXED_LAYER_CHANGE_GCODE = """; layer num/total_layer_count: {layer_num+1}/[total_layer_count]
; update layer progress
M73 L{layer_num+1}
M991 S0 P{layer_num} ;notify layer change
G92 E0 ;[layer_z]"""

# Problematic layer_change_gcode that needs fixing
PROBLEMATIC_GCODE = """; layer num/total_layer_count: {layer_num+1}/[total_layer_count]
; update layer progress
M73 L{layer_num+1}
M991 S0 P{layer_num} ;notify layer change"""

# Alternative problematic version with trailing newline
PROBLEMATIC_GCODE_ALT = """; layer num/total_layer_count: {layer_num+1}/[total_layer_count]
; update layer progress
M73 L{layer_num+1}
M991 S0 P{layer_num} ;notify layer change
"""

def backup_profile(profile_path):
    """Create a backup of the profile file"""
    backup_path = f"{profile_path}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(profile_path, backup_path)
    print(f"  ✓ Backup created: {backup_path}")
    return backup_path

def check_and_fix_profile(profile_path):
    """Check if profile needs fixing and apply fix if needed"""
    try:
        # Read the profile
        with open(profile_path, 'r', encoding='utf-8') as f:
            profile_data = json.load(f)
        
        # Get current layer_change_gcode
        current_gcode = profile_data.get('layer_change_gcode', '')
        
        # Check if this profile has the problematic gcode
        if current_gcode == PROBLEMATIC_GCODE or current_gcode == PROBLEMATIC_GCODE_ALT:
            print(f"  🔧 FIXING: Profile has problematic layer_change_gcode")
            
            # Create backup
            backup_path = backup_profile(profile_path)
            
            # Apply fix
            profile_data['layer_change_gcode'] = FIXED_LAYER_CHANGE_GCODE
            
            # Write updated profile
            with open(profile_path, 'w', encoding='utf-8') as f:
                json.dump(profile_data, f, indent=4, ensure_ascii=False)
            
            print(f"  ✅ FIXED: Added G92 E0 ;[layer_z] to layer_change_gcode")
            return True
            
        elif current_gcode == FIXED_LAYER_CHANGE_GCODE:
            print(f"  ✅ OK: Profile already has correct layer_change_gcode")
            return False
            
        elif 'G92 E0' in current_gcode:
            print(f"  ✅ OK: Profile already contains G92 E0 commands")
            return False
            
        elif current_gcode == '':
            print(f"  ✅ OK: Profile inherits layer_change_gcode from parent")
            return False
            
        else:
            print(f"  ℹ️  SKIP: Profile has custom layer_change_gcode:")
            print(f"       {repr(current_gcode[:100])}...")
            return False
            
    except Exception as e:
        print(f"  ❌ ERROR: Failed to process profile: {e}")
        return False

def main():
    """Main function to fix all Bambu Lab profiles"""
    # Find OrcaSlicer BBL machine profiles
    profile_base = "/home/pi/.local/share/flatpak/app/io.github.softfever.OrcaSlicer/aarch64/master/27a7f6f00decfbdea09a8836ea01a19d9af1f3d70a52126026fa9c729c99cc05/files/share/OrcaSlicer/profiles/BBL/machine"
    profile_pattern = f"{profile_base}/*.json"
    profile_files = glob.glob(profile_pattern)
    
    if not profile_files:
        print("❌ No OrcaSlicer BBL profiles found!")
        print(f"   Searched: {profile_pattern}")
        return 1
    
    print(f"🔍 Found {len(profile_files)} Bambu Lab profiles")
    print("=" * 80)
    
    fixed_count = 0
    total_count = len(profile_files)
    
    # Process each profile
    for profile_path in sorted(profile_files):
        profile_name = os.path.basename(profile_path)
        print(f"\n📄 Checking: {profile_name}")
        
        if check_and_fix_profile(profile_path):
            fixed_count += 1
    
    print("\n" + "=" * 80)
    print(f"🎯 SUMMARY:")
    print(f"   Total profiles checked: {total_count}")
    print(f"   Profiles fixed: {fixed_count}")
    print(f"   Profiles already OK: {total_count - fixed_count}")
    
    if fixed_count > 0:
        print(f"\n✅ Successfully fixed {fixed_count} Bambu Lab profiles!")
        print("   All profiles now include G92 E0 ;[layer_z] in layer_change_gcode")
        print("   This matches the working desktop OrcaSlicer configuration")
    else:
        print(f"\n✅ All profiles are already correctly configured!")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())