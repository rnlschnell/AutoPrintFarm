#!/usr/bin/env python3
"""
Database migration script to add build_plate_types table and current_build_plate column to printers table
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime

def run_migration():
    """
    Run the migration to add build_plate_types table and current_build_plate column
    """
    db_path = Path(__file__).parent / "data" / "tenant.db"

    if not db_path.exists():
        print(f"❌ Error: Database file not found at {db_path}")
        sys.exit(1)

    print(f"🔧 Starting migration on {db_path}")

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Check if build_plate_types table already exists
        cursor.execute("""
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='build_plate_types'
        """)

        if cursor.fetchone():
            print("⚠️  build_plate_types table already exists, skipping table creation")
        else:
            print("📝 Creating build_plate_types table...")

            cursor.execute("""
                CREATE TABLE build_plate_types (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    tenant_id VARCHAR(36) NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT unique_tenant_build_plate_name UNIQUE (tenant_id, name)
                )
            """)

            cursor.execute("""
                CREATE INDEX idx_build_plate_types_tenant ON build_plate_types (tenant_id)
            """)

            print("✅ build_plate_types table created successfully")

        # Check if current_build_plate column already exists in printers table
        cursor.execute("PRAGMA table_info(printers)")
        columns = [column[1] for column in cursor.fetchall()]

        if 'current_build_plate' in columns:
            print("⚠️  current_build_plate column already exists in printers table, skipping column addition")
        else:
            print("📝 Adding current_build_plate column to printers table...")

            cursor.execute("""
                ALTER TABLE printers ADD COLUMN current_build_plate TEXT
            """)

            print("✅ current_build_plate column added successfully")

        # Commit the changes
        conn.commit()
        print("✅ Migration completed successfully")

        # Display summary
        cursor.execute("SELECT COUNT(*) FROM build_plate_types")
        count = cursor.fetchone()[0]
        print(f"📊 Current build_plate_types count: {count}")

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
    Rollback the migration (remove table and column)
    """
    db_path = Path(__file__).parent / "data" / "tenant.db"

    if not db_path.exists():
        print(f"❌ Error: Database file not found at {db_path}")
        sys.exit(1)

    print(f"🔄 Rolling back migration on {db_path}")
    print("⚠️  WARNING: This will delete all build plate type data!")

    response = input("Are you sure you want to rollback? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Rollback cancelled")
        return False

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Drop table
        print("📝 Dropping build_plate_types table...")
        cursor.execute("DROP TABLE IF EXISTS build_plate_types")
        print("✅ build_plate_types table dropped")

        # Note: SQLite doesn't support DROP COLUMN directly
        # To remove current_build_plate column, we'd need to recreate the printers table
        print("⚠️  Note: SQLite doesn't support DROP COLUMN. The current_build_plate column will remain but can be ignored.")

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
    print("Build Plate Types Migration Script")
    print("=" * 60)
    print()

    if len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        success = rollback_migration()
    else:
        success = run_migration()
        print()
        print("To rollback this migration, run:")
        print("  python add_build_plate_types_migration.py --rollback")

    sys.exit(0 if success else 1)
