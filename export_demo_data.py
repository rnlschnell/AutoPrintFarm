#!/usr/bin/env python3
"""
Export tenant.db data to demo-data.json format for the marketing site demo.
This script extracts all relevant data from the PrintFarmSoftware database
and formats it for use in the autoprintfarm-site demo page.
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path

DB_PATH = "/home/pi/PrintFarmSoftware/data/tenant.db"
OUTPUT_PATH = "/home/pi/PrintFarmSoftware/demo-data.json"

def dict_factory(cursor, row):
    """Convert database row to dictionary."""
    fields = [column[0] for column in cursor.description]
    return {key: value for key, value in zip(fields, row)}

def export_printers(conn):
    """Export printer data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            name,
            model,
            manufacturer,
            status,
            current_color,
            current_color_hex,
            current_filament_type,
            location,
            ip_address,
            is_connected,
            filament_level,
            current_build_plate,
            nozzle_size,
            total_print_time,
            last_maintenance_date,
            in_maintenance,
            maintenance_type,
            created_at,
            updated_at
        FROM printers
        WHERE is_active = 1
        ORDER BY sort_order
    """)
    return cursor.fetchall()

def export_print_jobs(conn):
    """Export print job data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            printer_id,
            print_file_id,
            product_sku_id,
            file_name,
            status,
            color,
            filament_type,
            material_type,
            number_of_units,
            filament_needed_grams,
            estimated_print_time_minutes,
            actual_print_time_minutes,
            progress_percentage,
            priority,
            failure_reason,
            time_submitted,
            time_started,
            time_completed,
            product_name,
            sku_name,
            printer_model,
            printer_name,
            created_at,
            updated_at
        FROM print_jobs
        ORDER BY time_submitted DESC
        LIMIT 50
    """)
    return cursor.fetchall()

def export_products(conn):
    """Export product data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            name,
            description,
            category,
            print_file_id,
            file_name,
            requires_assembly,
            requires_post_processing,
            printer_priority,
            image_url,
            is_active,
            created_at,
            updated_at
        FROM products
        WHERE is_active = 1
        ORDER BY name
    """)
    return cursor.fetchall()

def export_product_skus(conn):
    """Export product SKU data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            ps.id,
            ps.product_id,
            ps.sku,
            ps.color,
            ps.filament_type,
            ps.hex_code,
            ps.quantity,
            ps.stock_level,
            ps.price,
            ps.low_stock_threshold,
            ps.is_active,
            ps.created_at,
            ps.updated_at,
            p.name as product_name
        FROM product_skus ps
        JOIN products p ON ps.product_id = p.id
        WHERE ps.is_active = 1
        ORDER BY p.name, ps.color
    """)
    return cursor.fetchall()

def export_finished_goods(conn):
    """Export finished goods inventory."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            product_sku_id,
            sku,
            color,
            material,
            current_stock,
            low_stock_threshold,
            quantity_per_sku,
            unit_price,
            extra_cost,
            profit_margin,
            requires_assembly,
            quantity_assembled,
            quantity_needs_assembly,
            status,
            image_url,
            is_active,
            created_at,
            updated_at
        FROM finished_goods
        WHERE is_active = 1
        ORDER BY sku
    """)
    return cursor.fetchall()

def export_assembly_tasks(conn):
    """Export assembly task data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            finished_good_id,
            assigned_to,
            product_name,
            sku,
            quantity,
            status,
            notes,
            created_at,
            updated_at,
            completed_at
        FROM assembly_tasks
        ORDER BY created_at DESC
        LIMIT 50
    """)
    return cursor.fetchall()

def export_color_presets(conn):
    """Export color preset data."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            id,
            color_name,
            hex_code,
            filament_type,
            is_active,
            created_at
        FROM color_presets
        WHERE is_active = 1
        ORDER BY filament_type, color_name
    """)
    return cursor.fetchall()

def export_build_plate_types(conn):
    """Export build plate types."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT *
        FROM build_plate_types
        WHERE is_active = 1
        ORDER BY name
    """)
    return cursor.fetchall()

def export_worklist_tasks(conn):
    """Export worklist tasks."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT *
        FROM worklist_tasks
        ORDER BY created_at DESC
    """)
    return cursor.fetchall()

def calculate_analytics(conn):
    """Calculate analytics and statistics from the data."""
    # Create a cursor without the dict_factory for aggregate queries
    cursor = conn.cursor()
    cursor.row_factory = None

    # Total prints
    cursor.execute("SELECT COUNT(*) FROM print_jobs WHERE status = 'completed'")
    total_prints = cursor.fetchone()[0]

    # Active printers
    cursor.execute("SELECT COUNT(*) FROM printers WHERE is_active = 1")
    active_printers = cursor.fetchone()[0]

    # Total products
    cursor.execute("SELECT COUNT(*) FROM products WHERE is_active = 1")
    total_products = cursor.fetchone()[0]

    # Total inventory value
    cursor.execute("""
        SELECT SUM(current_stock * unit_price)
        FROM finished_goods
        WHERE is_active = 1
    """)
    inventory_value = cursor.fetchone()[0] or 0

    # Print success rate
    cursor.execute("SELECT COUNT(*) FROM print_jobs WHERE status IN ('completed', 'failed', 'cancelled')")
    total_finished = cursor.fetchone()[0]
    success_rate = (total_prints / total_finished * 100) if total_finished > 0 else 100

    # Recent print jobs by status
    cursor.execute("""
        SELECT status, COUNT(*) as count
        FROM print_jobs
        GROUP BY status
    """)
    jobs_by_status = {row[0]: row[1] for row in cursor.fetchall()}

    # Inventory by material
    cursor.execute("""
        SELECT material, SUM(current_stock) as total
        FROM finished_goods
        WHERE is_active = 1
        GROUP BY material
    """)
    inventory_by_material = {row[0]: row[1] for row in cursor.fetchall()}

    # Low stock items
    cursor.execute("""
        SELECT COUNT(*)
        FROM finished_goods
        WHERE is_active = 1
        AND current_stock <= low_stock_threshold
    """)
    low_stock_items = cursor.fetchone()[0]

    return {
        "total_prints": total_prints,
        "active_printers": active_printers,
        "total_products": total_products,
        "inventory_value_cents": inventory_value,
        "success_rate_percentage": round(success_rate, 2),
        "jobs_by_status": jobs_by_status,
        "inventory_by_material": inventory_by_material,
        "low_stock_items": low_stock_items,
        "generated_at": datetime.now().isoformat()
    }

def main():
    """Main export function."""
    print(f"Connecting to database: {DB_PATH}")

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory

    try:
        print("Exporting data...")

        # Export all tables
        data = {
            "printers": export_printers(conn),
            "print_jobs": export_print_jobs(conn),
            "products": export_products(conn),
            "product_skus": export_product_skus(conn),
            "finished_goods": export_finished_goods(conn),
            "assembly_tasks": export_assembly_tasks(conn),
            "color_presets": export_color_presets(conn),
            "build_plate_types": export_build_plate_types(conn),
            "worklist_tasks": export_worklist_tasks(conn),
            "analytics": calculate_analytics(conn)
        }

        # Write to JSON file
        print(f"Writing to: {OUTPUT_PATH}")
        with open(OUTPUT_PATH, 'w') as f:
            json.dump(data, f, indent=2, default=str)

        print("\nExport Summary:")
        print(f"  Printers: {len(data['printers'])}")
        print(f"  Print Jobs: {len(data['print_jobs'])}")
        print(f"  Products: {len(data['products'])}")
        print(f"  Product SKUs: {len(data['product_skus'])}")
        print(f"  Finished Goods: {len(data['finished_goods'])}")
        print(f"  Assembly Tasks: {len(data['assembly_tasks'])}")
        print(f"  Color Presets: {len(data['color_presets'])}")
        print(f"  Build Plate Types: {len(data['build_plate_types'])}")
        print(f"  Worklist Tasks: {len(data['worklist_tasks'])}")
        print(f"\nAnalytics:")
        print(f"  Total Prints: {data['analytics']['total_prints']}")
        print(f"  Success Rate: {data['analytics']['success_rate_percentage']}%")
        print(f"  Inventory Value: ${data['analytics']['inventory_value_cents'] / 100:.2f}")
        print(f"\nData exported successfully to {OUTPUT_PATH}")

    finally:
        conn.close()

if __name__ == "__main__":
    main()
