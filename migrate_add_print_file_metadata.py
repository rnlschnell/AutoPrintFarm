#!/usr/bin/env python3
"""
Database migration script to add 3MF metadata fields to print_files table

This migration adds the following columns to support automatic metadata extraction from 3MF files:
- print_time_seconds: Print duration estimate in seconds
- filament_weight_grams: Total filament weight in grams
- filament_length_meters: Total filament length in meters
- filament_type: Material type (PLA, PETG, ABS, etc.)
- printer_model_id: Bambu printer model code (N1, N2S, P1P, X1, etc.)
- nozzle_diameter: Nozzle size in millimeters
- layer_count: Total number of layers
- curr_bed_type: Bed/plate type (e.g., "Textured PEI Plate")
- default_print_profile: Print profile used (e.g., "0.20mm Standard @BBL A1")

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

def add_metadata_columns():
    """Add 3MF metadata columns to print_files table"""

    if not DB_PATH.exists():
        logger.error(f"Database file not found: {DB_PATH}")
        return False

    try:
        # Connect to database
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        logger.info("Starting migration: Adding 3MF metadata columns to print_files table")

        # Define columns to add
        columns_to_add = [
            ("print_time_seconds", "INTEGER"),
            ("filament_weight_grams", "REAL"),
            ("filament_length_meters", "REAL"),
            ("filament_type", "TEXT"),
            ("printer_model_id", "TEXT"),
            ("nozzle_diameter", "REAL"),
            ("layer_count", "INTEGER"),
            ("curr_bed_type", "TEXT"),
            ("default_print_profile", "TEXT"),
        ]

        # Add each column if it doesn't exist
        added_count = 0
        skipped_count = 0

        for column_name, column_type in columns_to_add:
            if check_column_exists(cursor, "print_files", column_name):
                logger.info(f"Column '{column_name}' already exists, skipping")
                skipped_count += 1
            else:
                try:
                    cursor.execute(f"ALTER TABLE print_files ADD COLUMN {column_name} {column_type}")
                    logger.info(f"Added column '{column_name}' ({column_type})")
                    added_count += 1
                except sqlite3.OperationalError as e:
                    logger.error(f"Failed to add column '{column_name}': {e}")
                    conn.rollback()
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
        logger.info(f"  Added: {added_count} columns")
        logger.info(f"  Skipped: {skipped_count} columns (already exist)")

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
    logger.info("3MF Metadata Migration Script")
    logger.info("=" * 80)

    success = add_metadata_columns()

    if success:
        logger.info("\n✓ Migration completed successfully")
        sys.exit(0)
    else:
        logger.error("\n✗ Migration failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
