#!/usr/bin/env python3
"""
Database migration script to add low_stock_threshold column to product_skus table
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime

def run_migration():
    """
    Run the migration to add low_stock_threshold column to product_skus table
    """
    db_path = Path(__file__).parent / "data" / "tenant.db"

    if not db_path.exists():
        print(f"❌ Error: Database file not found at {db_path}")
        sys.exit(1)

    print(f"🔧 Starting migration on {db_path}")

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Check if low_stock_threshold column already exists in product_skus table
        cursor.execute("PRAGMA table_info(product_skus)")
        columns = [column[1] for column in cursor.fetchall()]

        if 'low_stock_threshold' in columns:
            print("⚠️  low_stock_threshold column already exists in product_skus table, skipping migration")
        else:
            print("📝 Adding low_stock_threshold column to product_skus table...")

            cursor.execute("""
                ALTER TABLE product_skus ADD COLUMN low_stock_threshold INTEGER DEFAULT 0
            """)

            print("✅ low_stock_threshold column added successfully")

        # Commit the changes
        conn.commit()
        print("✅ Migration completed successfully")

        # Display summary
        cursor.execute("SELECT COUNT(*) FROM product_skus WHERE low_stock_threshold = 0")
        default_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM product_skus")
        total_count = cursor.fetchone()[0]
        print(f"📊 Product SKUs with default threshold (0): {default_count}/{total_count}")

        return True

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        if conn:
            conn.rollback()
        return False

    finally:
        if conn:
            conn.close()

def rollback_migration():
    """
    Rollback the migration (note: SQLite doesn't support DROP COLUMN)
    """
    db_path = Path(__file__).parent / "data" / "tenant.db"

    if not db_path.exists():
        print(f"❌ Error: Database file not found at {db_path}")
        sys.exit(1)

    print(f"🔄 Rolling back migration on {db_path}")
    print("⚠️  Note: SQLite doesn't support DROP COLUMN directly.")
    print("⚠️  The low_stock_threshold column will remain but will be set to 0 for all SKUs.")

    response = input("Continue with setting low_stock_threshold to 0? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Rollback cancelled")
        return False

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Set all low_stock_threshold values to 0
        print("📝 Setting all low_stock_threshold values to 0...")
        cursor.execute("UPDATE product_skus SET low_stock_threshold = 0")
        print("✅ All low_stock_threshold values set to 0")

        conn.commit()
        print("✅ Rollback completed")

        return True

    except Exception as e:
        print(f"❌ Rollback failed: {e}")
        if conn:
            conn.rollback()
        return False

    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    print("=" * 60)
    print("Add Low Stock Threshold Column Migration Script")
    print("=" * 60)
    print()

    if len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        success = rollback_migration()
    else:
        success = run_migration()
        print()
        print("To rollback this migration, run:")
        print("  python add_low_stock_threshold_migration.py --rollback")

    sys.exit(0 if success else 1)
