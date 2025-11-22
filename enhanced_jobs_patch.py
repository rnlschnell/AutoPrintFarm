#!/usr/bin/env python3
import sys

# Read the file
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'r') as f:
    content = f.read()

# Add product_sku_id to CreateJobRequest model
if 'product_sku_id: Optional[str]' not in content:
    content = content.replace(
        'target_id: str  # print_file_id or product_id',
        'target_id: str  # print_file_id or product_id\n    product_sku_id: Optional[str] = None  # SKU id for product variants'
    )

# Add SKU fetching logic before job_data creation
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

if 'Fetch SKU data if product_sku_id is provided' not in content:
    content = content.replace(
        '        # Prepare job data for database',
        sku_logic + '        # Prepare job data for database'
    )

# Add new fields to job_data
if 'product_sku_id' not in content.split('job_data = {')[1].split('}')[0]:
    content = content.replace(
        '"tenant_id": tenant_id\n        }',
        '"tenant_id": tenant_id,\n            "product_sku_id": request.product_sku_id if hasattr(request, "product_sku_id") else None,\n            "requires_assembly": requires_assembly,\n            "quantity_per_print": quantity_per_print\n        }'
    )

# Write the updated content
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'w') as f:
    f.write(content)

print("Successfully updated enhanced_print_jobs.py")
