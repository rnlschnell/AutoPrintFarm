#!/usr/bin/env python3
"""
Migration script to add requires_post_processing column to products table
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
        cursor.execute("PRAGMA table_info(products)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        # Add requires_post_processing column if it doesn't exist
        if 'requires_post_processing' not in column_names:
            print("Adding requires_post_processing column...")
            cursor.execute("""
                ALTER TABLE products
                ADD COLUMN requires_post_processing BOOLEAN DEFAULT 0
            """)
            print("✓ requires_post_processing column added")
        else:
            print("requires_post_processing column already exists")

        # Commit changes
        conn.commit()

        # Verify the changes
        cursor.execute("PRAGMA table_info(products)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        if 'requires_post_processing' in column_names:
            print("\n✅ Migration completed successfully!")
            print(f"Total columns in products: {len(column_names)}")
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
