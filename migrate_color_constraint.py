#!/usr/bin/env python3
"""
Migration script to update color_presets unique constraint.

This script updates the unique constraint on the color_presets table from:
  UNIQUE(tenant_id, color_name)
to:
  UNIQUE(tenant_id, color_name, filament_type)

This allows the same color name to be used for different filament types.
"""

import sqlite3
import os
import sys
from datetime import datetime

DB_PATH = '/home/pi/PrintFarmSoftware/data/tenant.db'

def backup_database():
    """Create a backup of the database before migration."""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = f'{DB_PATH}.backup_{timestamp}'

    print(f"Creating backup at {backup_path}...")

    # Use shell command to copy the file
    import shutil
    shutil.copy2(DB_PATH, backup_path)

    print(f"✓ Backup created successfully")
    return backup_path

def migrate_constraint():
    """
    Migrate the color_presets table constraint.

    SQLite doesn't support ALTER TABLE to modify constraints, so we need to:
    1. Create a new table with the updated constraint
    2. Copy data from old table to new table
    3. Drop old table
    4. Rename new table to original name
    """

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("\nStarting migration...")

        # Check if migration is needed
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='color_presets'")
        result = cursor.fetchone()

        if result and 'unique_tenant_color_filament' in result[0]:
            print("✓ Migration already applied - constraint already includes filament_type")
            return True

        print("Creating new table with updated constraint...")

        # Create new table with updated constraint
        cursor.execute("""
            CREATE TABLE color_presets_new (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                color_name TEXT NOT NULL,
                hex_code TEXT NOT NULL,
                filament_type TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TEXT,
                CONSTRAINT unique_tenant_color_filament UNIQUE (tenant_id, color_name, filament_type)
            )
        """)

        # Create indexes with _new suffix temporarily
        cursor.execute("CREATE INDEX idx_color_presets_tenant_new ON color_presets_new(tenant_id)")
        cursor.execute("CREATE INDEX idx_color_presets_filament_type_new ON color_presets_new(filament_type)")

        print("Copying data from old table to new table...")

        # Copy data from old table to new table
        cursor.execute("""
            INSERT INTO color_presets_new (id, tenant_id, color_name, hex_code, filament_type, is_active, created_at)
            SELECT id, tenant_id, color_name, hex_code, filament_type, is_active, created_at
            FROM color_presets
        """)

        rows_copied = cursor.rowcount
        print(f"✓ Copied {rows_copied} rows")

        print("Dropping old table...")
        cursor.execute("DROP TABLE color_presets")

        print("Renaming new table...")
        cursor.execute("ALTER TABLE color_presets_new RENAME TO color_presets")

        print("Renaming indexes...")
        cursor.execute("DROP INDEX idx_color_presets_tenant_new")
        cursor.execute("DROP INDEX idx_color_presets_filament_type_new")
        cursor.execute("CREATE INDEX idx_color_presets_tenant ON color_presets(tenant_id)")
        cursor.execute("CREATE INDEX idx_color_presets_filament_type ON color_presets(filament_type)")

        # Commit the transaction
        conn.commit()

        print("✓ Migration completed successfully!")
        print("\nYou can now add colors with the same name but different filament types.")
        print("For example: 'Red' in PLA and 'Red' in PETG are now allowed.")

        return True

    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        conn.rollback()
        return False

    finally:
        conn.close()

def verify_migration():
    """Verify the migration was successful."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("\nVerifying migration...")

        # Check the table schema
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='color_presets'")
        schema = cursor.fetchone()[0]

        if 'unique_tenant_color_filament' in schema and 'tenant_id, color_name, filament_type' in schema:
            print("✓ Constraint successfully updated")
            return True
        else:
            print("✗ Constraint not updated correctly")
            print(f"Current schema: {schema}")
            return False

    finally:
        conn.close()

def main():
    """Main migration function."""
    print("=" * 60)
    print("Color Presets Constraint Migration")
    print("=" * 60)

    # Check if database exists
    if not os.path.exists(DB_PATH):
        print(f"✗ Database not found at {DB_PATH}")
        sys.exit(1)

    # Create backup
    backup_path = backup_database()

    # Run migration
    success = migrate_constraint()

    if success:
        # Verify migration
        if verify_migration():
            print("\n" + "=" * 60)
            print("✓ Migration completed and verified successfully!")
            print(f"Backup available at: {backup_path}")
            print("=" * 60)
            sys.exit(0)
        else:
            print("\n✗ Migration verification failed")
            sys.exit(1)
    else:
        print(f"\n✗ Migration failed. Database backup available at: {backup_path}")
        sys.exit(1)

if __name__ == '__main__':
    main()
