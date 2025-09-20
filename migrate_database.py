#!/usr/bin/env python3
"""
Database migration script to add new columns for print job tracking
"""

import sqlite3
import sys
from pathlib import Path

def migrate_database():
    """Add new columns to print_jobs table"""

    # Find the database file - check both possible locations
    db_path = Path("/home/pi/PrintFarmSoftware/data/tenant.db")
    if not db_path.exists():
        # Try alternate location
        db_path = Path("/home/pi/PrintFarmSoftware/tenant.db")
        if not db_path.exists():
            print(f"Database not found at {db_path}")
            return False

    print(f"Migrating database at {db_path}")

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Check if columns already exist
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = [col[1] for col in cursor.fetchall()]

        # Add bambu_job_id column if it doesn't exist
        if 'bambu_job_id' not in columns:
            print("Adding bambu_job_id column...")
            cursor.execute("ALTER TABLE print_jobs ADD COLUMN bambu_job_id TEXT")
            print("✓ Added bambu_job_id column")
        else:
            print("✓ bambu_job_id column already exists")

        # Add printer_numeric_id column if it doesn't exist
        if 'printer_numeric_id' not in columns:
            print("Adding printer_numeric_id column...")
            cursor.execute("ALTER TABLE print_jobs ADD COLUMN printer_numeric_id INTEGER")
            print("✓ Added printer_numeric_id column")
        else:
            print("✓ printer_numeric_id column already exists")

        # Add last_sync_time column if it doesn't exist
        if 'last_sync_time' not in columns:
            print("Adding last_sync_time column...")
            cursor.execute("ALTER TABLE print_jobs ADD COLUMN last_sync_time DATETIME")
            print("✓ Added last_sync_time column")
        else:
            print("✓ last_sync_time column already exists")

        # Commit changes
        conn.commit()
        conn.close()

        print("\n✅ Database migration completed successfully!")
        return True

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False

if __name__ == "__main__":
    success = migrate_database()
    sys.exit(0 if success else 1)