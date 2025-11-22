#!/usr/bin/env python3
import sys

# Read the file
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'r') as f:
    content = f.read()

# Add the SKU fetching logic after getting the product
updated_content = content

# Find where we prepare job_data and update it to include SKU fields
job_data_start = updated_content.find('job_data = {')
if job_data_start != -1:
    # Find the closing brace
    job_data_end = updated_content.find('}', job_data_start)
    
    # Insert new fields before the closing brace
    insertion_point = job_data_end
    new_fields = '''"product_sku_id": request.product_sku_id if hasattr(request, 'product_sku_id') else None,
            "requires_assembly": False,  # Will be updated with SKU data
            "quantity_per_print": 1,  # Will be updated with SKU data
            '''
    
    # Find the last comma before the closing brace
    last_comma_pos = updated_content.rfind(',', job_data_start, job_data_end)
    if last_comma_pos != -1:
        # Insert after the last field
        updated_content = updated_content[:job_data_end] + ',\n            ' + new_fields + updated_content[job_data_end:]

# Write the updated file
with open('/home/pi/PrintFarmSoftware/src/api/enhanced_print_jobs.py', 'w') as f:
    f.write(updated_content)

print("Updated enhanced_print_jobs.py with SKU fields")
