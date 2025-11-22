#!/usr/bin/env python3
"""
Migration script to fix print_files with NULL printer_model_id

This script:
1. Finds all print_files records with NULL or empty printer_model_id
2. Locates the corresponding 3MF files on disk
3. Extracts metadata from the files
4. Updates the database with the extracted metadata
"""

import sqlite3
import sys
import os
from pathlib import Path

# Add the src directory to path to import metadata_parser
sys.path.insert(0, '/home/pi/PrintFarmSoftware/src')

from utils.metadata_parser import parse_3mf_metadata

DB_PATH = '/home/pi/PrintFarmSoftware/data/tenant.db'
PRINT_FILES_DIR = Path('/home/pi/PrintFarmSoftware/files/print_files')

def main():
    print("=" * 80)
    print("Fix Print File Metadata Migration Script")
    print("=" * 80)
    
    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Find all print_files with NULL or empty printer_model_id
    cursor.execute("""
        SELECT id, name, local_file_path 
        FROM print_files 
        WHERE printer_model_id IS NULL OR printer_model_id = ''
    """)
    
    files_to_fix = cursor.fetchall()
    
    if not files_to_fix:
        print("\n✅ No files need fixing - all print_files have printer_model_id")
        conn.close()
        return
    
    print(f"\nFound {len(files_to_fix)} files to fix:\n")
    
    fixed_count = 0
    error_count = 0
    
    for file_id, name, local_file_path in files_to_fix:
        print(f"Processing: {name} (ID: {file_id})")
        
        # Determine file path
        if local_file_path and os.path.exists(local_file_path):
            file_path = Path(local_file_path)
        else:
            # Try to find file by ID with .3mf extension
            file_path = PRINT_FILES_DIR / f"{file_id}.3mf"
            if not file_path.exists():
                print(f"  ❌ ERROR: File not found at {file_path}")
                error_count += 1
                continue
        
        print(f"  📁 File: {file_path}")
        
        # Parse metadata
        try:
            metadata = parse_3mf_metadata(str(file_path))
            
            # Check if we got printer_model_id
            if not metadata.get('printer_model_id'):
                print(f"  ❌ ERROR: Could not extract printer_model_id from file")
                error_count += 1
                continue
            
            # Update database
            cursor.execute("""
                UPDATE print_files 
                SET 
                    printer_model_id = ?,
                    print_time_seconds = ?,
                    filament_weight_grams = ?,
                    filament_length_meters = ?,
                    filament_type = ?,
                    nozzle_diameter = ?,
                    layer_count = ?,
                    curr_bed_type = ?,
                    default_print_profile = ?,
                    local_file_path = ?
                WHERE id = ?
            """, (
                metadata.get('printer_model_id'),
                metadata.get('print_time_seconds'),
                metadata.get('filament_weight_grams'),
                metadata.get('filament_length_meters'),
                metadata.get('filament_type'),
                metadata.get('nozzle_diameter'),
                metadata.get('layer_count'),
                metadata.get('curr_bed_type'),
                metadata.get('default_print_profile'),
                str(file_path),
                file_id
            ))
            
            print(f"  ✅ Updated: printer_model_id = {metadata.get('printer_model_id')}")
            print(f"     Print time: {metadata.get('print_time_seconds')}s")
            print(f"     Filament: {metadata.get('filament_weight_grams')}g {metadata.get('filament_type')}")
            
            fixed_count += 1
            
        except Exception as e:
            print(f"  ❌ ERROR: Failed to parse metadata: {e}")
            error_count += 1
            continue
        
        print()
    
    # Commit changes
    conn.commit()
    conn.close()
    
    print("=" * 80)
    print(f"✅ Fixed: {fixed_count} files")
    print(f"❌ Errors: {error_count} files")
    print("=" * 80)
    
    # Verify no NULL printer_model_id remains
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) 
        FROM print_files 
        WHERE printer_model_id IS NULL OR printer_model_id = ''
    """)
    remaining = cursor.fetchone()[0]
    conn.close()
    
    if remaining == 0:
        print("\n🎉 SUCCESS: All print_files now have printer_model_id!")
    else:
        print(f"\n⚠️  WARNING: {remaining} files still have NULL printer_model_id")
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
