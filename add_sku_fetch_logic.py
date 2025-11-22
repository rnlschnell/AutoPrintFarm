#!/usr/bin/env python3
import sys

# Read the file
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'r') as f:
    lines = f.readlines()

# Find where job_data is created and add SKU fetching logic before it
new_lines = []
for i, line in enumerate(lines):
    new_lines.append(line)
    
    # After resolving file info, add SKU fetching logic
    if '# Prepare job data for database' in line:
        # Insert SKU fetching logic before job data preparation
        sku_logic = '''        # Fetch SKU data if product_sku_id is provided
        requires_assembly = False
        quantity_per_print = 1
        
        if hasattr(request, 'product_sku_id') and request.product_sku_id:
            logger.info(f"Fetching SKU data for {request.product_sku_id}")
            try:
                # Get the SKU details
                sku = await db_service.get_product_sku_by_id(request.product_sku_id)
                if sku:
                    quantity_per_print = sku.quantity
                    
                    # Get product to check assembly requirement
                    product = await db_service.get_product_by_id(request.target_id)
                    if product:
                        requires_assembly = product.requires_assembly
                        
                    logger.info(f"SKU data: quantity={quantity_per_print}, assembly={requires_assembly}")
            except Exception as sku_error:
                logger.warning(f"Failed to fetch SKU data: {sku_error}")
        
'''
        new_lines.insert(i, sku_logic)
        break

# Write the updated file
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'w') as f:
    f.writelines(new_lines)

print("Added SKU fetching logic to enhanced_print_jobs.py")
