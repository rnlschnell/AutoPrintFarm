#!/usr/bin/env python3
"""
Migration script to add failure tracking columns to printers table
Adds: consecutive_failures, disabled_reason, disabled_at
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

        # Add consecutive_failures column if it doesn't exist
        if 'consecutive_failures' not in column_names:
            print("\nAdding consecutive_failures column...")
            cursor.execute("""
                ALTER TABLE printers
                ADD COLUMN consecutive_failures INTEGER DEFAULT 0
            """)
            print("✓ consecutive_failures column added")
        else:
            print("\nconsecutive_failures column already exists")

        # Add disabled_reason column if it doesn't exist
        if 'disabled_reason' not in column_names:
            print("Adding disabled_reason column...")
            cursor.execute("""
                ALTER TABLE printers
                ADD COLUMN disabled_reason TEXT
            """)
            print("✓ disabled_reason column added")
        else:
            print("disabled_reason column already exists")

        # Add disabled_at column if it doesn't exist
        if 'disabled_at' not in column_names:
            print("Adding disabled_at column...")
            cursor.execute("""
                ALTER TABLE printers
                ADD COLUMN disabled_at TIMESTAMP
            """)
            print("✓ disabled_at column added")
        else:
            print("disabled_at column already exists")

        # Commit changes
        conn.commit()

        # Verify the changes
        cursor.execute("PRAGMA table_info(printers)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        required_columns = ['consecutive_failures', 'disabled_reason', 'disabled_at']
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
