#!/usr/bin/env python3
"""
Fix Missing Printer IDs Script

This script assigns sequential printer_id values to any printers in the database
that have NULL or missing printer_id values. This is needed for installations where
printers were added before the printer_id field was properly implemented or where
data was synced from Supabase without printer_id values.

Usage:
    python src/migrations/fix_printer_ids.py

This script can be run safely multiple times - it will only assign printer_id to
printers that don't have one.
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.services.database_service import get_database_service
from src.services.config_service import get_config_service


async def fix_printer_ids():
    """
    Assign sequential printer_id values to printers that don't have one
    """
    print("=" * 60)
    print("Printer ID Fix Script")
    print("=" * 60)
    print()

    # Get tenant ID from config
    config_service = get_config_service()
    tenant_config = config_service.get_tenant_config()
    tenant_id = tenant_config.get('id', '').strip()

    if not tenant_id:
        print("ERROR: Tenant not configured in tenant.yaml")
        return False

    print(f"Tenant ID: {tenant_id}")
    print()

    # Get database service
    db_service = await get_database_service()
    await db_service.initialize_database()

    # Get all printers for this tenant
    printers = await db_service.get_printers_by_tenant(tenant_id)

    if not printers:
        print("No printers found for this tenant.")
        return True

    print(f"Found {len(printers)} printers")
    print()

    # Separate printers into those with and without printer_id
    printers_with_id = [p for p in printers if p.printer_id is not None]
    printers_without_id = [p for p in printers if p.printer_id is None]

    print(f"Printers with printer_id: {len(printers_with_id)}")
    print(f"Printers without printer_id: {len(printers_without_id)}")
    print()

    if not printers_without_id:
        print("✅ All printers already have printer_id assigned!")
        print()
        print("Current printers:")
        for printer in sorted(printers_with_id, key=lambda p: p.printer_id):
            print(f"  - {printer.name} (printer_id: {printer.printer_id}, UUID: {printer.id})")
        return True

    # Find the maximum existing printer_id
    max_printer_id = 0
    if printers_with_id:
        max_printer_id = max(p.printer_id for p in printers_with_id)

    print(f"Maximum existing printer_id: {max_printer_id}")
    print()
    print("Assigning printer_id to printers without one:")
    print()

    # Assign sequential printer_ids
    next_printer_id = max_printer_id + 1
    updates_made = 0

    for printer in sorted(printers_without_id, key=lambda p: p.created_at):
        print(f"  Assigning printer_id {next_printer_id} to: {printer.name} (UUID: {printer.id})")

        # Update printer with new printer_id
        update_data = {
            'id': printer.id,
            'tenant_id': tenant_id,
            'printer_id': next_printer_id
        }

        success = await db_service.upsert_printer(update_data)

        if success:
            updates_made += 1
            next_printer_id += 1
        else:
            print(f"  ❌ Failed to update {printer.name}")

    print()
    print("=" * 60)
    print(f"✅ Fix completed! Assigned printer_id to {updates_made} printers")
    print("=" * 60)
    print()

    # Show final state
    printers = await db_service.get_printers_by_tenant(tenant_id)
    print("Final printer list:")
    for printer in sorted(printers, key=lambda p: p.printer_id if p.printer_id else 999):
        status = "✓" if printer.printer_id else "✗"
        pid = printer.printer_id if printer.printer_id else "NULL"
        print(f"  {status} {printer.name} (printer_id: {pid}, UUID: {printer.id})")

    print()
    return True


if __name__ == "__main__":
    print()
    try:
        result = asyncio.run(fix_printer_ids())
        sys.exit(0 if result else 1)
    except Exception as e:
        print()
        print(f"❌ ERROR: {e}")
        print()
        import traceback
        traceback.print_exc()
        sys.exit(1)
