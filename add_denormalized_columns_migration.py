#!/usr/bin/env python3
"""
Migration script to add denormalized columns to print_jobs table:
- product_id (VARCHAR(36)) - FK to products
- product_name (TEXT) - Denormalized product name
- sku_name (TEXT) - Denormalized SKU code
- printer_model (TEXT) - Denormalized printer model name
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

        # Add product_id column if it doesn't exist
        if 'product_id' not in column_names:
            print("Adding product_id column...")
            cursor.execute("""
                ALTER TABLE print_jobs
                ADD COLUMN product_id VARCHAR(36)
            """)
            print("✓ product_id column added")
        else:
            print("product_id column already exists")

        # Add product_name column if it doesn't exist
        if 'product_name' not in column_names:
            print("Adding product_name column...")
            cursor.execute("""
                ALTER TABLE print_jobs
                ADD COLUMN product_name TEXT
            """)
            print("✓ product_name column added")
        else:
            print("product_name column already exists")

        # Add sku_name column if it doesn't exist
        if 'sku_name' not in column_names:
            print("Adding sku_name column...")
            cursor.execute("""
                ALTER TABLE print_jobs
                ADD COLUMN sku_name TEXT
            """)
            print("✓ sku_name column added")
        else:
            print("sku_name column already exists")

        # Add printer_model column if it doesn't exist
        if 'printer_model' not in column_names:
            print("Adding printer_model column...")
            cursor.execute("""
                ALTER TABLE print_jobs
                ADD COLUMN printer_model TEXT
            """)
            print("✓ printer_model column added")
        else:
            print("printer_model column already exists")

        # Commit changes
        conn.commit()

        # Verify the changes
        cursor.execute("PRAGMA table_info(print_jobs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        new_columns = ['product_id', 'product_name', 'sku_name', 'printer_model']
        if all(col in column_names for col in new_columns):
            print("\n✅ Migration completed successfully!")
            print(f"Total columns in print_jobs: {len(column_names)}")
            print(f"New columns added: {', '.join(new_columns)}")
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
