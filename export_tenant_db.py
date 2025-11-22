#!/usr/bin/env python3
"""
Export tenant.db SQLite database to Excel format.
Each table will be exported to a separate sheet in the Excel file.
"""

import sqlite3
import pandas as pd
from pathlib import Path
from datetime import datetime

# Configuration
DB_PATH = "/home/pi/PrintFarmSoftware/data/tenant.db"
OUTPUT_DIR = "/home/pi/PrintFarmSoftware/data"
OUTPUT_FILENAME = f"tenant_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
OUTPUT_PATH = f"{OUTPUT_DIR}/{OUTPUT_FILENAME}"

def export_database_to_excel():
    """Export all tables from SQLite database to Excel file."""
    print(f"Starting database export...")
    print(f"Database: {DB_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print("-" * 60)

    # Connect to database
    try:
        conn = sqlite3.connect(DB_PATH)
        print(f"✓ Connected to database")
    except Exception as e:
        print(f"✗ Error connecting to database: {e}")
        return

    # Get all table names (excluding SQLite internal tables)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    )
    tables = [row[0] for row in cursor.fetchall()]

    if not tables:
        print("✗ No tables found in database")
        conn.close()
        return

    print(f"✓ Found {len(tables)} tables to export")
    print()

    # Create Excel writer
    try:
        with pd.ExcelWriter(OUTPUT_PATH, engine='openpyxl') as writer:
            total_rows = 0

            for table in tables:
                try:
                    # Read table into DataFrame
                    df = pd.read_sql_query(f"SELECT * FROM {table}", conn)
                    row_count = len(df)
                    total_rows += row_count

                    # Excel sheet names are limited to 31 characters
                    sheet_name = table[:31]

                    # Write to Excel sheet
                    df.to_excel(writer, sheet_name=sheet_name, index=False)

                    print(f"✓ {table:25s} → {row_count:5d} rows exported")

                except Exception as e:
                    print(f"✗ {table:25s} → Error: {e}")

            print()
            print("-" * 60)
            print(f"✓ Export complete!")
            print(f"  Total tables: {len(tables)}")
            print(f"  Total rows: {total_rows}")
            print(f"  Output file: {OUTPUT_PATH}")

    except Exception as e:
        print(f"✗ Error creating Excel file: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    export_database_to_excel()
