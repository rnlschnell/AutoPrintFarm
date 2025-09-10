"""
Sync handlers for processing CRUD operations from Supabase Realtime
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime

from .database_service import DatabaseService

logger = logging.getLogger(__name__)

class SyncHandler:
    """
    Handler for processing sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        
        Args:
            db_service: Database service instance
        """
        self.db_service = db_service
        logger.info("Sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase
        
        Args:
            record: New record data from Supabase
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.debug(f"Processing INSERT for record {record.get('id')}")
            
            # Validate required fields
            if not self._validate_printer_record(record):
                logger.error(f"Invalid printer record for INSERT: {record}")
                return False
            
            # Insert/update in local database (skip backup since this comes from Supabase)
            success = await self.db_service.upsert_printer(record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed INSERT for printer {record.get('id')}")
                
                # Additional processing for new printers
                await self._on_printer_added(record)
            else:
                logger.error(f"Failed to process INSERT for printer {record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase
        
        Args:
            new_record: Updated record data from Supabase
            old_record: Previous record data (may be None)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.debug(f"Processing UPDATE for record {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_printer_record(new_record):
                logger.error(f"Invalid printer record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            success = await self.db_service.upsert_printer(new_record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed UPDATE for printer {new_record.get('id')}")
                
                # Additional processing for updated printers
                await self._on_printer_updated(new_record, old_record)
            else:
                logger.error(f"Failed to process UPDATE for printer {new_record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
            
        Returns:
            True if successful, False otherwise
        """
        try:
            printer_id = old_record.get('id')
            
            if not printer_id:
                logger.error(f"Missing printer ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for record {printer_id}")
            
            # Hard delete in local database
            success = await self.db_service.delete_printer(printer_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for printer {printer_id}")
                
                # Additional processing for deleted printers
                await self._on_printer_deleted(old_record)
            else:
                logger.error(f"Failed to process DELETE for printer {printer_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling DELETE: {e}")
            return False
    
    def _validate_printer_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a printer record has required fields
        
        Args:
            record: Printer record to validate
            
        Returns:
            True if valid, False otherwise
        """
        required_fields = ['id', 'tenant_id', 'name', 'model']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in printer record")
                return False
        
        # Validate status if present
        status = record.get('status')
        if status and status not in ['idle', 'printing', 'maintenance', 'offline']:
            logger.error(f"Invalid status '{status}' in printer record")
            return False
        
        # Validate connection type if present
        connection_type = record.get('connection_type')
        if connection_type and connection_type not in ['bambu', 'prusa', 'ender', 'other']:
            logger.error(f"Invalid connection_type '{connection_type}' in printer record")
            return False
        
        return True
    
    async def _on_printer_added(self, record: Dict[str, Any]):
        """
        Additional processing when a printer is added
        
        Args:
            record: New printer record
        """
        try:
            printer_id = record.get('id')
            printer_name = record.get('name')
            
            logger.info(f"New printer added: {printer_name} ({printer_id})")
            
            # Log the addition
            await self.db_service.log_sync_operation(
                operation_type="PRINTER_ADDED",
                table_name="printers",
                record_id=printer_id,
                tenant_id=record.get('tenant_id'),
                status="SUCCESS"
            )
            
            # Trigger printer connection through connection service
            from .printer_connection_service import get_printer_connection_service
            connection_service = await get_printer_connection_service()
            
            if connection_service:
                logger.info(f"Triggering printer connection for newly added printer: {printer_name}")
                await connection_service.handle_printer_added(record)
            else:
                logger.warning("Printer connection service not available")
            
        except Exception as e:
            logger.error(f"Error in printer added handler: {e}")
    
    async def _on_printer_updated(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None):
        """
        Additional processing when a printer is updated
        
        Args:
            new_record: Updated printer record
            old_record: Previous printer record (may be None)
        """
        try:
            printer_id = new_record.get('id')
            printer_name = new_record.get('name')
            
            # Check what changed
            changes = []
            if old_record:
                for key, new_value in new_record.items():
                    old_value = old_record.get(key)
                    if old_value != new_value:
                        changes.append(f"{key}: {old_value} -> {new_value}")
            
            if changes:
                logger.info(f"Printer {printer_name} ({printer_id}) updated: {', '.join(changes[:3])}{'...' if len(changes) > 3 else ''}")
            
            # Log the update
            await self.db_service.log_sync_operation(
                operation_type="PRINTER_UPDATED",
                table_name="printers",
                record_id=printer_id,
                tenant_id=new_record.get('tenant_id'),
                status="SUCCESS"
            )
            
            # Check for critical connection setting changes
            connection_fields = ['ip_address', 'access_code', 'serial_number']
            connection_changed = False
            
            if old_record:
                for field in connection_fields:
                    if old_record.get(field) != new_record.get(field):
                        connection_changed = True
                        break
            
            if connection_changed:
                logger.info(f"Connection settings changed for printer {printer_name}, triggering reconnection")
                
                # Trigger printer reconnection through connection service
                from .printer_connection_service import get_printer_connection_service
                connection_service = await get_printer_connection_service()
                
                if connection_service:
                    logger.info(f"Handling printer update with connection changes: {printer_name}")
                    await connection_service.handle_printer_updated(new_record)
                else:
                    logger.warning("Printer connection service not available")
            
        except Exception as e:
            logger.error(f"Error in printer updated handler: {e}")
    
    async def _on_printer_deleted(self, record: Dict[str, Any]):
        """
        Additional processing when a printer is deleted
        
        Args:
            record: Deleted printer record
        """
        try:
            printer_id = record.get('id')
            printer_name = record.get('name', 'Unknown')
            
            logger.info(f"Printer deleted: {printer_name} ({printer_id})")
            
            # Log the deletion
            await self.db_service.log_sync_operation(
                operation_type="PRINTER_DELETED",
                table_name="printers",
                record_id=printer_id,
                tenant_id=record.get('tenant_id'),
                status="SUCCESS"
            )
            
            # Trigger printer disconnection through connection service
            from .printer_connection_service import get_printer_connection_service
            connection_service = await get_printer_connection_service()
            
            if connection_service:
                logger.info(f"Triggering printer disconnection for deleted printer: {printer_name}")
                await connection_service.handle_printer_deleted(record)
            else:
                logger.warning("Printer connection service not available")
            
        except Exception as e:
            logger.error(f"Error in printer deleted handler: {e}")
    
    async def validate_sync_integrity(self, tenant_id: str) -> Dict[str, Any]:
        """
        Validate sync integrity by comparing local data with Supabase
        
        Args:
            tenant_id: Tenant ID to validate
            
        Returns:
            Dictionary with validation results
        """
        try:
            # Get local printers
            local_printers = await self.db_service.get_printers_by_tenant(tenant_id)
            local_printer_ids = {printer.id for printer in local_printers}
            
            # This would require Supabase client access, so we'll return a placeholder
            # In a real implementation, you'd fetch from Supabase and compare
            
            return {
                'local_printer_count': len(local_printers),
                'validation_timestamp': datetime.utcnow().isoformat(),
                'status': 'completed'
            }
            
        except Exception as e:
            logger.error(f"Error validating sync integrity: {e}")
            return {
                'status': 'error',
                'error': str(e),
                'validation_timestamp': datetime.utcnow().isoformat()
            }


class ColorPresetSyncHandler:
    """
    Handler for processing color preset sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize color preset sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        
        Args:
            db_service: Database service instance
        """
        self.db_service = db_service
        logger.info("Color preset sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase for color presets
        
        Args:
            record: New record data from Supabase
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.debug(f"Processing INSERT for color preset {record.get('id')}")
            
            # Validate required fields
            if not self._validate_color_preset_record(record):
                logger.error(f"Invalid color preset record for INSERT: {record}")
                return False
            
            # Insert/update in local database
            success = await self.db_service.upsert_color_preset(record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed INSERT for color preset {record.get('id')} - {record.get('color_name')}")
            else:
                logger.error(f"Failed to process INSERT for color preset {record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling color preset INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase for color presets
        
        Args:
            new_record: Updated record data from Supabase
            old_record: Previous record data (may be None)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.debug(f"Processing UPDATE for color preset {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_color_preset_record(new_record):
                logger.error(f"Invalid color preset record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            success = await self.db_service.upsert_color_preset(new_record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed UPDATE for color preset {new_record.get('id')} - {new_record.get('color_name')}")
                
                # Log what changed
                if old_record:
                    changes = []
                    for key, new_value in new_record.items():
                        old_value = old_record.get(key)
                        if old_value != new_value and key not in ['updated_at']:
                            changes.append(f"{key}: {old_value} -> {new_value}")
                    if changes:
                        logger.info(f"Color preset changes: {', '.join(changes[:3])}{'...' if len(changes) > 3 else ''}")
            else:
                logger.error(f"Failed to process UPDATE for color preset {new_record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling color preset UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase for color presets
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
            
        Returns:
            True if successful, False otherwise
        """
        try:
            preset_id = old_record.get('id')
            
            if not preset_id:
                logger.error(f"Missing color preset ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for color preset {preset_id}")
            
            # Hard delete from local database
            success = await self.db_service.delete_color_preset(preset_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for color preset {preset_id} - {old_record.get('color_name')}")
            else:
                logger.error(f"Failed to process DELETE for color preset {preset_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling color preset DELETE: {e}")
            return False
    
    def _validate_color_preset_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a color preset record has required fields
        
        Args:
            record: Color preset record to validate
            
        Returns:
            True if valid, False otherwise
        """
        required_fields = ['id', 'tenant_id', 'color_name', 'hex_code', 'filament_type']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in color preset record")
                return False
        
        # Validate hex code format
        hex_code = record.get('hex_code')
        if hex_code:
            # Remove # if present and validate
            hex_code = hex_code.lstrip('#')
            if not all(c in '0123456789ABCDEFabcdef' for c in hex_code) or len(hex_code) not in [3, 6]:
                logger.error(f"Invalid hex code '{hex_code}' in color preset record")
                return False
        
        return True


class ProductSyncHandler:
    """
    Handler for processing product sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize product sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        """
        self.db_service = db_service
        logger.info("Product sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase for products
        """
        try:
            logger.debug(f"Processing INSERT for product {record.get('id')}")
            
            # Validate required fields
            if not self._validate_product_record(record):
                logger.error(f"Invalid product record for INSERT: {record}")
                return False
            
            # Insert/update in local database
            success = await self.db_service.upsert_product(record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed INSERT for product {record.get('id')} - {record.get('name')}")
            else:
                logger.error(f"Failed to process INSERT for product {record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase for products
        """
        try:
            logger.debug(f"Processing UPDATE for product {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_product_record(new_record):
                logger.error(f"Invalid product record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            success = await self.db_service.upsert_product(new_record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed UPDATE for product {new_record.get('id')} - {new_record.get('name')}")
                
                # Log what changed
                if old_record:
                    changes = []
                    for key, new_value in new_record.items():
                        old_value = old_record.get(key)
                        if old_value != new_value and key not in ['updated_at']:
                            changes.append(f"{key}: {old_value} -> {new_value}")
                    if changes:
                        logger.info(f"Product changes: {', '.join(changes[:3])}{'...' if len(changes) > 3 else ''}")
            else:
                logger.error(f"Failed to process UPDATE for product {new_record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase for products
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
        """
        try:
            product_id = old_record.get('id')
            
            if not product_id:
                logger.error(f"Missing product ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for product {product_id}")
            
            # Hard delete from local database (matches Supabase CASCADE behavior)
            success = await self.db_service.delete_product(product_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for product {product_id} - {old_record.get('name')}")
            else:
                logger.error(f"Failed to process DELETE for product {product_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product DELETE: {e}")
            return False
    
    def _validate_product_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a product record has required fields
        """
        required_fields = ['id', 'tenant_id', 'name']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in product record")
                return False
        
        return True


class ProductSkuSyncHandler:
    """
    Handler for processing product SKU sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize product SKU sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        """
        self.db_service = db_service
        logger.info("Product SKU sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase for product SKUs
        """
        try:
            logger.debug(f"Processing INSERT for product SKU {record.get('id')}")
            
            # Validate required fields
            if not self._validate_sku_record(record):
                logger.error(f"Invalid product SKU record for INSERT: {record}")
                return False
            
            # Insert/update in local database
            success = await self.db_service.upsert_product_sku(record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed INSERT for product SKU {record.get('id')} - {record.get('sku')}")
                # Trigger any stock-related updates if needed
                await self._handle_stock_change(record)
            else:
                logger.error(f"Failed to process INSERT for product SKU {record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product SKU INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase for product SKUs
        """
        try:
            logger.debug(f"Processing UPDATE for product SKU {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_sku_record(new_record):
                logger.error(f"Invalid product SKU record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            success = await self.db_service.upsert_product_sku(new_record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed UPDATE for product SKU {new_record.get('id')} - {new_record.get('sku')}")
                
                # Check if stock level changed
                if old_record and old_record.get('stock_level') != new_record.get('stock_level'):
                    logger.info(f"Stock level changed from {old_record.get('stock_level')} to {new_record.get('stock_level')}")
                    await self._handle_stock_change(new_record)
            else:
                logger.error(f"Failed to process UPDATE for product SKU {new_record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product SKU UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase for product SKUs
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
        """
        try:
            sku_id = old_record.get('id')
            
            if not sku_id:
                logger.error(f"Missing SKU ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for product SKU {sku_id}")
            
            # Hard delete from local database (matches Supabase CASCADE behavior)
            success = await self.db_service.delete_product_sku(sku_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for product SKU {sku_id} - {old_record.get('sku')}")
            else:
                logger.error(f"Failed to process DELETE for product SKU {sku_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling product SKU DELETE: {e}")
            return False
    
    def _validate_sku_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a product SKU record has required fields
        """
        required_fields = ['id', 'tenant_id', 'product_id', 'sku', 'color']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in product SKU record")
                return False
        
        return True
    
    async def _handle_stock_change(self, record: Dict[str, Any]):
        """
        Handle stock level changes for a SKU
        """
        try:
            stock_level = record.get('stock_level', 0)
            sku = record.get('sku')
            
            # Log stock change
            await self.db_service.log_sync_operation(
                operation_type="STOCK_UPDATE",
                table_name="product_skus",
                record_id=record.get('id'),
                tenant_id=record.get('tenant_id'),
                status="SUCCESS"
            )
            
            logger.info(f"Stock level for SKU {sku} is now {stock_level}")
            
        except Exception as e:
            logger.error(f"Error handling stock change: {e}")


class PrintFileSyncHandler:
    """
    Handler for processing print file sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize print file sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        """
        self.db_service = db_service
        logger.info("Print file sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase for print files
        """
        try:
            logger.debug(f"Processing INSERT for print file {record.get('id')}")
            
            # Validate required fields
            if not self._validate_file_record(record):
                logger.error(f"Invalid print file record for INSERT: {record}")
                return False
            
            # Insert/update in local database
            success = await self.db_service.upsert_print_file(record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed INSERT for print file {record.get('id')} - {record.get('name')}")
                
                # Try to associate with local file using the file association service
                await self._try_associate_file(record)
            else:
                logger.error(f"Failed to process INSERT for print file {record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling print file INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase for print files
        """
        try:
            logger.debug(f"Processing UPDATE for print file {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_file_record(new_record):
                logger.error(f"Invalid print file record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            success = await self.db_service.upsert_print_file(new_record, skip_backup=True)
            
            if success:
                logger.info(f"Successfully processed UPDATE for print file {new_record.get('id')} - {new_record.get('name')}")
                
                # If no local_file_path yet, try to associate with local file
                if not new_record.get('local_file_path'):
                    await self._try_associate_file(new_record)
            else:
                logger.error(f"Failed to process UPDATE for print file {new_record.get('id')}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling print file UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase for print files
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
        """
        try:
            file_id = old_record.get('id')
            
            if not file_id:
                logger.error(f"Missing print file ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for print file {file_id}")
            
            # Delete associated local file if it exists
            await self._cleanup_local_file(file_id, tenant_id)
            
            # Hard delete from local database
            success = await self.db_service.delete_print_file(file_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for print file {file_id} - {old_record.get('name')}")
            else:
                logger.error(f"Failed to process DELETE for print file {file_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling print file DELETE: {e}")
            return False
    
    def _validate_file_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a print file record has required fields
        """
        required_fields = ['id', 'tenant_id', 'name']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in print file record")
                return False
        
        return True
    
    async def _try_associate_file(self, record: Dict[str, Any]):
        """
        Try to associate a realtime sync record with a local file
        
        Args:
            record: Print file record from Supabase
        """
        try:
            # Add a small delay to account for realtime sync timing
            import asyncio
            await asyncio.sleep(0.5)
            
            # Convert dict to PrintFile model for the service
            from ..models.database import PrintFile
            print_file = PrintFile.from_supabase_dict(record)
            
            # Get file association service
            from .file_association_service import get_file_association_service
            file_service = await get_file_association_service()
            
            # Try to associate the file
            success = await file_service.associate_synced_record(print_file)
            
            if success:
                logger.info(f"Successfully associated file for print file record {record.get('id')}")
            else:
                logger.debug(f"No matching file found yet for print file record {record.get('id')} - background service will retry")
                
        except Exception as e:
            logger.warning(f"Error trying to associate file for record {record.get('id')}: {e}")
    
    async def _cleanup_local_file(self, file_id: str, tenant_id: str):
        """
        Clean up local file when a print file record is deleted
        
        Args:
            file_id: ID of the print file record
            tenant_id: Tenant ID
        """
        try:
            from pathlib import Path
            
            # Construct expected file path
            file_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id / f"{file_id}.3mf"
            
            if file_path.exists():
                file_path.unlink()
                logger.info(f"Cleaned up local file: {file_path}")
            else:
                logger.debug(f"Local file not found for cleanup: {file_path}")
                
        except Exception as e:
            logger.warning(f"Error cleaning up local file for {file_id}: {e}")


class PrintJobSyncHandler:
    """
    Handler for processing print job sync operations from Supabase
    """
    
    def __init__(self):
        """
        Initialize print job sync handler
        """
        self.db_service: Optional[DatabaseService] = None
    
    async def initialize(self, db_service: DatabaseService):
        """
        Initialize with database service
        """
        self.db_service = db_service
        logger.info("Print job sync handler initialized")
    
    async def handle_insert(self, record: Dict[str, Any]) -> bool:
        """
        Handle INSERT operations from Supabase for print jobs
        """
        try:
            logger.debug(f"Processing INSERT for print job {record.get('id')}")
            
            # Validate required fields
            if not self._validate_job_record(record):
                logger.error(f"Invalid print job record for INSERT: {record}")
                return False
            
            # Insert/update in local database
            result = await self.db_service.upsert_print_job(record, skip_backup=True)
            
            if result:
                logger.info(f"Successfully processed INSERT for print job {record.get('id')} - {record.get('file_name')}")
                await self._handle_job_status_change(record, None)
                return True
            else:
                logger.error(f"Failed to process INSERT for print job {record.get('id')}")
                return False
            
        except Exception as e:
            logger.error(f"Error handling print job INSERT: {e}")
            return False
    
    async def handle_update(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None) -> bool:
        """
        Handle UPDATE operations from Supabase for print jobs
        """
        try:
            logger.debug(f"Processing UPDATE for print job {new_record.get('id')}")
            
            # Validate required fields
            if not self._validate_job_record(new_record):
                logger.error(f"Invalid print job record for UPDATE: {new_record}")
                return False
            
            # Update in local database
            result = await self.db_service.upsert_print_job(new_record, skip_backup=True)
            
            if result:
                logger.info(f"Successfully processed UPDATE for print job {new_record.get('id')} - {new_record.get('file_name')}")
                
                # Check if status changed
                if old_record and old_record.get('status') != new_record.get('status'):
                    logger.info(f"Job status changed from {old_record.get('status')} to {new_record.get('status')}")
                    await self._handle_job_status_change(new_record, old_record)
                
                # Check if progress changed
                if old_record and old_record.get('progress_percentage') != new_record.get('progress_percentage'):
                    logger.info(f"Job progress: {new_record.get('progress_percentage')}%")
                return True
            else:
                logger.error(f"Failed to process UPDATE for print job {new_record.get('id')}")
                return False
            
        except Exception as e:
            logger.error(f"Error handling print job UPDATE: {e}")
            return False
    
    async def handle_delete(self, old_record: Dict[str, Any], tenant_id: str) -> bool:
        """
        Handle DELETE operations from Supabase for print jobs
        
        Args:
            old_record: Deleted record data (contains only 'id' for DELETE events)
            tenant_id: Tenant ID from the sync service context
        """
        try:
            job_id = old_record.get('id')
            
            if not job_id:
                logger.error(f"Missing print job ID for DELETE: {old_record}")
                return False
            
            logger.debug(f"Processing DELETE for print job {job_id}")
            
            # Hard delete from local database
            success = await self.db_service.delete_print_job(job_id, tenant_id)
            
            if success:
                logger.info(f"Successfully processed DELETE for print job {job_id} - {old_record.get('file_name')}")
            else:
                logger.error(f"Failed to process DELETE for print job {job_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error handling print job DELETE: {e}")
            return False
    
    def _validate_job_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate that a print job record has required fields
        """
        required_fields = ['id', 'tenant_id', 'print_file_id', 'file_name', 'color', 'filament_type', 'material_type']
        
        for field in required_fields:
            if not record.get(field):
                logger.error(f"Missing required field '{field}' in print job record")
                return False
        
        # Validate status
        status = record.get('status')
        if status and status not in ['queued', 'printing', 'completed', 'failed', 'cancelled']:
            logger.error(f"Invalid status '{status}' in print job record")
            return False
        
        return True
    
    async def _handle_job_status_change(self, new_record: Dict[str, Any], old_record: Dict[str, Any] = None):
        """
        Handle print job status changes
        """
        try:
            new_status = new_record.get('status')
            job_id = new_record.get('id')
            
            # Log status change
            await self.db_service.log_sync_operation(
                operation_type="STATUS_CHANGE",
                table_name="print_jobs",
                record_id=job_id,
                tenant_id=new_record.get('tenant_id'),
                status="SUCCESS"
            )
            
            # Handle specific status transitions
            if new_status == 'completed':
                logger.info(f"Print job {job_id} completed successfully")
                # Could trigger stock updates if connected to product SKUs
                if new_record.get('product_sku_id'):
                    logger.info(f"Job was for product SKU {new_record.get('product_sku_id')}")
            
            elif new_status == 'failed':
                logger.warning(f"Print job {job_id} failed: {new_record.get('failure_reason')}")
            
            elif new_status == 'printing':
                logger.info(f"Print job {job_id} started printing on printer {new_record.get('printer_id')}")
            
        except Exception as e:
            logger.error(f"Error handling job status change: {e}")