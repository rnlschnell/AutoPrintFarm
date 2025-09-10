#!/usr/bin/env python3
# Script to fix the home_axes method in printer_client.py

import re

# Read the file
with open('/home/pi/bambu-program/src/core/printer_client.py', 'r') as f:
    content = f.read()

# New home_axes implementation
new_home_axes = '''    async def home_axes(self, printer_id: str) -> bool:
        """Home all axes using Bambu Labs API"""
        client = self.get_client(printer_id)
        try:
            # Use bambulabs_api home_printer method directly
            result = await asyncio.to_thread(client.home_printer)
            logger.info(f"Successfully homed printer {printer_id}, result: {result}")
            return True if result is None else result
        except Exception as e:
            logger.error(f"Failed to home axes: {e}")
            raise PrinterConnectionError(f"Failed to home axes: {e}")'''

# Replace the home_axes method
pattern = r'(    async def home_axes\(self, printer_id: str\) -> bool:.*?)(    async def [a-zA-Z_]+\()'
replacement = new_home_axes + '\n\n\\2'
content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Write back
with open('/home/pi/bambu-program/src/core/printer_client.py', 'w') as f:
    f.write(content)

print("Fixed home_axes method in printer_client.py")