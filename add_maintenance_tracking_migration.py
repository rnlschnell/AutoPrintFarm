#!/usr/bin/env python3
"""
Migration script to add maintenance tracking columns to printers table
Adds: in_maintenance, maintenance_type
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

        # Check existing columns
        cursor.execute("PRAGMA table_info(printers)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        print(f"Current columns: {', '.join(column_names)}")

        # Add in_maintenance column if it doesn't exist
        if 'in_maintenance' not in column_names:
            print("\nAdding in_maintenance column...")
            cursor.execute("""
                ALTER TABLE printers
                ADD COLUMN in_maintenance BOOLEAN DEFAULT 0
            """)
            print("✓ in_maintenance column added")
        else:
            print("\nin_maintenance column already exists")

        # Add maintenance_type column if it doesn't exist
        if 'maintenance_type' not in column_names:
            print("Adding maintenance_type column...")
            cursor.execute("""
                ALTER TABLE printers
                ADD COLUMN maintenance_type TEXT
            """)
            print("✓ maintenance_type column added")
        else:
            print("maintenance_type column already exists")

        # Commit changes
        conn.commit()

        # Verify the changes
        cursor.execute("PRAGMA table_info(printers)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        required_columns = ['in_maintenance', 'maintenance_type']
        all_present = all(col in column_names for col in required_columns)

        if all_present:
            print("\n✅ Migration completed successfully!")
            print(f"Total columns in printers table: {len(column_names)}")
            print(f"New columns verified: {', '.join(required_columns)}")
        else:
            missing = [col for col in required_columns if col not in column_names]
            print(f"\n⚠️ Migration may have failed. Missing columns: {', '.join(missing)}")

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
