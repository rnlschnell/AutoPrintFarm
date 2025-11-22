#!/usr/bin/env python3
"""
Migration script to add requires_assembly and quantity_per_print columns to print_jobs table
"""

import sqlite3
import sys
from datetime import datetime

def migrate_database():
    db_path = '/home/pi/PrintFarmSoftware/data/tenant.db'
    
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        print(f"Connected to database: {db_path}")
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        # Add requires_assembly column if it doesn't exist
        if 'requires_assembly' not in column_names:
            print("Adding requires_assembly column...")
            cursor.execute("""
                ALTER TABLE print_jobs 
                ADD COLUMN requires_assembly BOOLEAN DEFAULT 0
            """)
            print("✓ requires_assembly column added")
        else:
            print("requires_assembly column already exists")
        
        # Add quantity_per_print column if it doesn't exist
        if 'quantity_per_print' not in column_names:
            print("Adding quantity_per_print column...")
            cursor.execute("""
                ALTER TABLE print_jobs 
                ADD COLUMN quantity_per_print INTEGER DEFAULT 1
            """)
            print("✓ quantity_per_print column added")
        else:
            print("quantity_per_print column already exists")
        
        # Commit changes
        conn.commit()
        
        # Verify the changes
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        if 'requires_assembly' in column_names and 'quantity_per_print' in column_names:
            print("\n✅ Migration completed successfully!")
            print(f"Total columns in print_jobs: {len(column_names)}")
        else:
            print("\n⚠️ Migration may have failed. Please check the schema.")
            
    except sqlite3.Error as e:
        print(f"\n❌ Database error: {e}")
        return 1
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        return 1
    finally:
        if conn:
            conn.close()
    
    return 0

if __name__ == "__main__":
    sys.exit(migrate_database())
