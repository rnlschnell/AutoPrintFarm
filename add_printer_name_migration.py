#!/usr/bin/env python3
"""
Migration script to add printer_name column to print_jobs table
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

        # Check if column already exists
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        # Add printer_name column if it doesn't exist
        if 'printer_name' not in column_names:
            print("Adding printer_name column...")
            cursor.execute("""
                ALTER TABLE print_jobs
                ADD COLUMN printer_name TEXT
            """)
            print("✓ printer_name column added")
        else:
            print("printer_name column already exists")

        # Commit changes
        conn.commit()

        # Verify the changes
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        if 'printer_name' in column_names:
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
