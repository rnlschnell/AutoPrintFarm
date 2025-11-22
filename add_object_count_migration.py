#!/usr/bin/env python3
"""
Database migration script to add object_count column to print_files table

This migration adds the object_count column to support automatic object counting
from 3MF files. The column stores the number of objects/instances being printed
in a single 3MF file (e.g., 17 instances of the same part).

All columns allow NULL values for backward compatibility with existing records.
"""

import sqlite3
import logging
import sys
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Database path
DB_PATH = Path("/home/pi/PrintFarmSoftware/data/tenant.db")

def check_column_exists(cursor, table_name, column_name):
    """Check if a column already exists in a table"""
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = cursor.fetchall()
    return any(col[1] == column_name for col in columns)

def add_object_count_column():
    """Add object_count column to print_files table"""

    if not DB_PATH.exists():
        logger.error(f"Database file not found: {DB_PATH}")
        return False

    try:
        # Connect to database
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        logger.info("Starting migration: Adding object_count column to print_files table")

        # Check if column already exists
        if check_column_exists(cursor, "print_files", "object_count"):
            logger.info("Column 'object_count' already exists, skipping migration")
            conn.close()
            return True

        # Add column
        try:
            cursor.execute("ALTER TABLE print_files ADD COLUMN object_count INTEGER")
            logger.info("Added column 'object_count' (INTEGER)")
        except sqlite3.OperationalError as e:
            logger.error(f"Failed to add column 'object_count': {e}")
            conn.rollback()
            conn.close()
            return False

        # Commit changes
        conn.commit()

        # Verify the schema
        cursor.execute("PRAGMA table_info(print_files)")
        columns = cursor.fetchall()

        logger.info("\nFinal print_files table schema:")
        for col in columns:
            logger.info(f"  {col[1]}: {col[2]}")

        # Close connection
        conn.close()

        logger.info(f"\nMigration completed successfully!")
        logger.info(f"  Added: 1 column (object_count)")

        return True

    except sqlite3.Error as e:
        logger.error(f"Database error: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False

def main():
    """Main entry point"""
    logger.info("=" * 80)
    logger.info("Object Count Migration Script")
    logger.info("=" * 80)

    success = add_object_count_column()

    if success:
        logger.info("\n✓ Migration completed successfully")
        sys.exit(0)
    else:
        logger.error("\n✗ Migration failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
