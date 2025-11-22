#!/usr/bin/env python3
"""
Database migration script to restructure finished_goods table assembly tracking

Changes:
1. Remove assembly_status column
2. Add requires_assembly column (inherited from products.requires_assembly)
3. Add quantity_assembled column
4. Add quantity_needs_assembly column
5. Migrate existing data appropriately

Run this script from the PrintFarmSoftware root directory:
python src/migrate_finished_goods_assembly.py
"""

import sqlite3
from datetime import datetime
import os

def migrate_finished_goods_assembly(db_path):
    """
    Migrate the finished_goods table to new assembly tracking structure
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        print(f"Starting migration at {datetime.now()}")

        # Step 1: Check current state
        print("Checking current table structure...")
        cursor.execute("PRAGMA table_info(finished_goods)")
        current_columns = [row[1] for row in cursor.fetchall()]
        print(f"Current columns: {current_columns}")

        # Step 2: Add new columns with defaults
        print("Adding new columns...")

        # Add requires_assembly column
        if 'requires_assembly' not in current_columns:
            cursor.execute('ALTER TABLE finished_goods ADD COLUMN requires_assembly BOOLEAN DEFAULT 0')
            print("Added requires_assembly column")

        # Add quantity_assembled column
        if 'quantity_assembled' not in current_columns:
            cursor.execute('ALTER TABLE finished_goods ADD COLUMN quantity_assembled INTEGER DEFAULT 0')
            print("Added quantity_assembled column")

        # Add quantity_needs_assembly column
        if 'quantity_needs_assembly' not in current_columns:
            cursor.execute('ALTER TABLE finished_goods ADD COLUMN quantity_needs_assembly INTEGER DEFAULT 0')
            print("Added quantity_needs_assembly column")

        # Step 3: Populate new columns based on product requirements and current stock
        print("Populating new columns with existing data...")
        cursor.execute('''
            UPDATE finished_goods
            SET requires_assembly = (
                SELECT products.requires_assembly
                FROM product_skus
                JOIN products ON product_skus.product_id = products.id
                WHERE product_skus.id = finished_goods.product_sku_id
            )
        ''')
        print("Updated requires_assembly from products table")

        # For products that don't require assembly: all stock is assembled
        cursor.execute('''
            UPDATE finished_goods
            SET quantity_assembled = current_stock,
                quantity_needs_assembly = 0
            WHERE requires_assembly = 0
        ''')

        # For products that require assembly: all stock needs assembly
        cursor.execute('''
            UPDATE finished_goods
            SET quantity_assembled = 0,
                quantity_needs_assembly = current_stock
            WHERE requires_assembly = 1
        ''')

        print("Populated quantity columns based on assembly requirements")

        # Step 4: Show migration results
        print("\nMigration results:")
        cursor.execute('''
            SELECT
                fg.sku,
                p.name as product_name,
                fg.current_stock,
                fg.requires_assembly,
                fg.quantity_assembled,
                fg.quantity_needs_assembly
            FROM finished_goods fg
            JOIN product_skus ps ON fg.product_sku_id = ps.id
            JOIN products p ON ps.product_id = p.id
        ''')

        results = cursor.fetchall()
        print("SKU | Product | Stock | Requires Assembly | Assembled | Needs Assembly")
        print("-" * 80)
        for row in results:
            print(f"{row[0]} | {row[1]} | {row[2]} | {bool(row[3])} | {row[4]} | {row[5]}")

        # Step 5: Remove old assembly_status column
        print("\nRemoving old assembly_status column...")

        # SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        # First, let's get the current table schema without assembly_status
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='finished_goods'")
        original_schema = cursor.fetchone()[0]
        print(f"Original schema: {original_schema}")

        # Create new table without assembly_status column
        new_schema = '''
            CREATE TABLE finished_goods_new (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                product_sku_id VARCHAR(36) NOT NULL,
                tenant_id VARCHAR(36) NOT NULL,
                print_job_id VARCHAR(36),
                sku TEXT NOT NULL,
                color TEXT NOT NULL,
                material TEXT NOT NULL,
                current_stock INTEGER NOT NULL,
                low_stock_threshold INTEGER,
                quantity_per_sku INTEGER,
                unit_price INTEGER NOT NULL,
                extra_cost INTEGER,
                profit_margin INTEGER,
                requires_assembly BOOLEAN DEFAULT 0,
                quantity_assembled INTEGER DEFAULT 0,
                quantity_needs_assembly INTEGER DEFAULT 0,
                status TEXT,
                image_url TEXT,
                is_active BOOLEAN,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY(product_sku_id) REFERENCES product_skus (id) ON DELETE CASCADE
            )
        '''

        cursor.execute(new_schema)
        print("Created new table structure")

        # Copy data from old table to new table (excluding assembly_status)
        cursor.execute('''
            INSERT INTO finished_goods_new (
                id, product_sku_id, tenant_id, print_job_id, sku, color, material,
                current_stock, low_stock_threshold, quantity_per_sku, unit_price,
                extra_cost, profit_margin, requires_assembly, quantity_assembled,
                quantity_needs_assembly, status, image_url, is_active, created_at, updated_at
            )
            SELECT
                id, product_sku_id, tenant_id, print_job_id, sku, color, material,
                current_stock, low_stock_threshold, quantity_per_sku, unit_price,
                extra_cost, profit_margin, requires_assembly, quantity_assembled,
                quantity_needs_assembly, status, image_url, is_active, created_at, updated_at
            FROM finished_goods
        ''')
        print("Copied data to new table")

        # Drop old table and rename new table
        cursor.execute('DROP TABLE finished_goods')
        cursor.execute('ALTER TABLE finished_goods_new RENAME TO finished_goods')
        print("Replaced old table with new structure")

        # Recreate indexes
        print("Recreating indexes...")
        cursor.execute('CREATE INDEX idx_finished_goods_status ON finished_goods (status)')
        cursor.execute('CREATE INDEX idx_finished_goods_product_sku ON finished_goods (product_sku_id)')
        cursor.execute('CREATE INDEX idx_finished_goods_tenant ON finished_goods (tenant_id)')
        cursor.execute('CREATE INDEX idx_finished_goods_requires_assembly ON finished_goods (requires_assembly)')
        print("Recreated indexes")

        # Commit all changes
        conn.commit()
        print(f"\nMigration completed successfully at {datetime.now()}")

        # Final verification
        cursor.execute("PRAGMA table_info(finished_goods)")
        final_columns = [row[1] for row in cursor.fetchall()]
        print(f"Final columns: {final_columns}")

    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
        raise

    finally:
        conn.close()


def main():
    """Main migration function"""
    # Determine database path
    db_path = "/home/pi/PrintFarmSoftware/data/tenant.db"

    # For local testing, use a different path if the pi path doesn't exist
    if not os.path.exists(db_path):
        local_db_path = "./data/tenant.db"
        if os.path.exists(local_db_path):
            db_path = local_db_path
        else:
            print(f"Database not found at {db_path} or {local_db_path}")
            return

    print(f"Using database: {db_path}")

    # Create backup before migration
    backup_path = f"{db_path}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"Created backup at: {backup_path}")

    # Run migration
    migrate_finished_goods_assembly(db_path)
    print("Migration script completed!")


if __name__ == "__main__":
    main()