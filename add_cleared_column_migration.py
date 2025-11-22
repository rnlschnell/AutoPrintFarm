#!/usr/bin/env python3
"""
Database migration script to add cleared column to printers table
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime

def run_migration():
    """
    Run the migration to add cleared column to printers table
    """
    db_path = Path(__file__).parent / "data" / "tenant.db"

    if not db_path.exists():
        print(f"❌ Error: Database file not found at {db_path}")
        sys.exit(1)

    print(f"🔧 Starting migration on {db_path}")

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Check if cleared column already exists in printers table
        cursor.execute("PRAGMA table_info(printers)")
        columns = [column[1] for column in cursor.fetchall()]

        if 'cleared' in columns:
            print("⚠️  cleared column already exists in printers table, skipping migration")
        else:
            print("📝 Adding cleared column to printers table...")

            cursor.execute("""
                ALTER TABLE printers ADD COLUMN cleared BOOLEAN DEFAULT 1
            """)

            print("✅ cleared column added successfully")

        # Commit the changes
        conn.commit()
        print("✅ Migration completed successfully")

        # Display summary
        cursor.execute("SELECT COUNT(*) FROM printers WHERE cleared = 1")
        cleared_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM printers")
        total_count = cursor.fetchone()[0]
        print(f"📊 Printers marked as cleared: {cleared_count}/{total_count}")

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
    print("⚠️  The cleared column will remain but will be set to NULL for all printers.")

    response = input("Continue with setting cleared to NULL? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Rollback cancelled")
        return False

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Set all cleared values to NULL
        print("📝 Setting all cleared values to NULL...")
        cursor.execute("UPDATE printers SET cleared = NULL")
        print("✅ All cleared values set to NULL")

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
    print("Add Cleared Column Migration Script")
    print("=" * 60)
    print()

    if len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        success = rollback_migration()
    else:
        success = run_migration()
        print()
        print("To rollback this migration, run:")
        print("  python add_cleared_column_migration.py --rollback")

    sys.exit(0 if success else 1)
