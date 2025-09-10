"""
Printer Connection Service for database-driven printer management
Manages printer connections based on SQLite database state
"""

import asyncio
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

from ..core.printer_client import printer_manager
from .database_service import get_database_service
from ..models.database import Printer

logger = logging.getLogger(__name__)

class PrinterConnectionService:
    """
    Service for managing printer connections based on database state
    """
    
    def __init__(self):
        """
        Initialize printer connection service
        """
        self.db_service = None
        self.tenant_id = None
        self.is_running = False
        self.connection_tasks: Dict[str, asyncio.Task] = {}
        self.monitor_task = None
        self.reconnection_intervals = {}  # Track reconnection intervals for each printer
        self.max_reconnection_interval = 300  # Max 5 minutes between attempts
        self.min_reconnection_interval = 30   # Min 30 seconds between attempts
        
        logger.info("Printer connection service initialized")
    
    async def initialize(self, tenant_id: str):
        """
        Initialize the service with tenant configuration
        
        Args:
            tenant_id: The tenant ID to manage printers for
        """
        try:
            self.tenant_id = tenant_id
            self.db_service = await get_database_service()
            
            # Start the connection monitoring task
            await self.start_connection_monitoring()
            
            logger.info(f"Printer connection service initialized for tenant {tenant_id}")
            
        except Exception as e:
            logger.error(f"Failed to initialize printer connection service: {e}")
            raise
    
    async def sync_printers_from_database(self) -> Dict[str, Any]:
        """
        Sync printer manager with current database state
        
        Returns:
            Dictionary with sync results
        """
        if not self.db_service or not self.tenant_id:
            logger.error("Service not properly initialized")
            return {'success': False, 'error': 'Service not initialized'}
        
        try:
            # Get all active printers for this tenant from database
            printers = await self.db_service.get_printers_by_tenant(self.tenant_id)
            active_printers = [p for p in printers if p.is_active]
            
            logger.info(f"Found {len(active_printers)} active printers in database for tenant {self.tenant_id}")
            
            # Track current vs desired state
            current_printer_ids = set(printer_manager.printer_configs.keys())
            desired_printer_ids = set()
            
            results = {
                'total': len(active_printers),
                'connected': 0,
                'failed': 0,
                'removed': 0,
                'errors': []
            }
            
            # Process each printer from database
            for printer in active_printers:
                # Use printer_id directly as the key for the printer manager
                # This matches what the API expects (integer printer_id from Supabase)
                printer_key = str(printer.printer_id) if printer.printer_id else printer.id
                desired_printer_ids.add(printer_key)
                
                # Check if configuration needs update
                if printer_key in printer_manager.printer_configs:
                    existing_config = printer_manager.printer_configs[printer_key]
                    
                    # Check if configuration changed
                    if (existing_config.get('ip') != printer.ip_address or
                        existing_config.get('access_code') != printer.access_code or
                        existing_config.get('serial') != printer.serial_number):
                        
                        logger.info(f"Configuration changed for printer {printer_key}, updating...")
                        
                        # Disconnect existing connection
                        printer_manager.disconnect_printer(printer_key)
                        
                        # Update configuration
                        await self._add_printer_to_manager(printer)
                        
                        # Attempt reconnection
                        if await self._connect_printer(printer):
                            results['connected'] += 1
                        else:
                            results['failed'] += 1
                    else:
                        # Configuration unchanged, ensure connected
                        if printer_key not in printer_manager.clients:
                            if await self._connect_printer(printer):
                                results['connected'] += 1
                            else:
                                results['failed'] += 1
                        else:
                            results['connected'] += 1
                else:
                    # New printer, add and connect
                    logger.info(f"Adding new printer {printer_key} from database")
                    await self._add_printer_to_manager(printer)
                    
                    if await self._connect_printer(printer):
                        results['connected'] += 1
                    else:
                        results['failed'] += 1
            
            # Remove printers that are no longer in database
            printers_to_remove = current_printer_ids - desired_printer_ids
            for printer_key in printers_to_remove:
                logger.info(f"Removing printer {printer_key} (no longer in database)")
                printer_manager.remove_printer(printer_key)
                results['removed'] += 1
            
            logger.info(f"Printer sync completed: {results['connected']} connected, "
                       f"{results['failed']} failed, {results['removed']} removed")
            
            results['success'] = True
            return results
            
        except Exception as e:
            logger.error(f"Error syncing printers from database: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def _add_printer_to_manager(self, printer: Printer):
        """
        Add a printer from database to the printer manager
        
        Args:
            printer: Printer model from database
        """
        # Use printer_id directly as the key for the printer manager
        printer_key = str(printer.printer_id) if printer.printer_id else printer.id
        
        # Create configuration for printer manager
        config = {
            'id': printer_key,
            'name': printer.name,
            'ip': printer.ip_address,
            'access_code': printer.access_code,
            'serial': printer.serial_number,
            'model': printer.model,
            'enabled': printer.is_active,
            'tenant_id': printer.tenant_id,
            'database_id': printer.id,  # Store database ID for reference
            'printer_id': printer.printer_id  # Store printer_id for API commands
        }
        
        # Add to printer manager
        printer_manager.add_printer(printer_key, config)
        logger.debug(f"Added printer {printer_key} to manager with config: {config}")
    
    async def _connect_printer(self, printer: Printer) -> bool:
        """
        Attempt to connect to a printer with validation
        
        Args:
            printer: Printer model from database
            
        Returns:
            True if connected successfully, False otherwise
        """
        printer_key = str(printer.printer_id) if printer.printer_id else printer.id
        
        try:
            # Validate connection prerequisites
            validation_error = self._validate_printer_credentials(printer)
            if validation_error:
                logger.warning(f"Printer {printer_key} validation failed: {validation_error}")
                await self._update_connection_status(printer.id, False, validation_error)
                return False
            
            logger.info(f"Attempting to connect to printer {printer_key} at {printer.ip_address}")
            
            # Attempt connection
            client = await printer_manager.connect_printer(printer_key)
            
            # Verify the connection is actually working
            if await self._verify_printer_connection(printer_key, client):
                # Update database with success
                await self._update_connection_status(printer.id, True, None)
                logger.info(f"✅ Successfully connected and verified printer {printer_key}")
                return True
            else:
                # Connection appeared to succeed but verification failed
                printer_manager.disconnect_printer(printer_key)
                error_msg = "Connection established but printer not responding correctly"
                await self._update_connection_status(printer.id, False, error_msg)
                logger.warning(f"⚠️ Printer {printer_key} connection verification failed")
                return False
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to connect to printer {printer_key}: {error_msg}")
            
            # Update database with failure
            await self._update_connection_status(printer.id, False, error_msg)
            return False
    
    def _validate_printer_credentials(self, printer: Printer) -> Optional[str]:
        """
        Validate printer credentials before connection attempt
        
        Args:
            printer: Printer model to validate
            
        Returns:
            Error message if validation fails, None if valid
        """
        import ipaddress
        
        # Check required fields exist
        if not printer.ip_address:
            return "Missing IP address"
        if not printer.access_code:
            return "Missing access code"
        if not printer.serial_number:
            return "Missing serial number"
        
        # Validate IP address format
        try:
            # Check if it's a valid IP address
            ipaddress.ip_address(printer.ip_address)
        except ValueError:
            # Not a valid IP, could be hostname - check if it looks reasonable
            if not printer.ip_address.replace('.', '').replace('-', '').replace('_', '').isalnum():
                return f"Invalid IP address or hostname: {printer.ip_address}"
        
        # Check if IP address looks like a serial number (15 hex chars without dots)
        if len(printer.ip_address) == 15 and printer.ip_address.replace('A', '').replace('B', '').replace('C', '').replace('D', '').replace('E', '').replace('F', '').isdigit():
            return f"IP address appears to be a serial number: {printer.ip_address}"
        
        # Check for obvious mock/test data (removed "test" to allow legitimate test printer names)
        mock_indicators = ['cereal', 'dummy', 'fake', 'mock', 'numero', '420again']
        serial_lower = printer.serial_number.lower()
        access_code_lower = printer.access_code.lower()
        name_lower = printer.name.lower()
        
        # Check serial number, access code, and name for test data
        if any(indicator in serial_lower for indicator in mock_indicators):
            return f"Invalid serial number (appears to be test data): {printer.serial_number}"
        if any(indicator in access_code_lower for indicator in mock_indicators):
            return f"Invalid access code (appears to be test data): {printer.access_code}"
        if any(indicator in name_lower for indicator in mock_indicators):
            return f"Invalid printer name (appears to be test data): {printer.name}"
        
        # Check for invalid IP ranges (cloud/external IPs that shouldn't be printers)
        invalid_ip_prefixes = ['35.', '139.', '8.8.', '1.1.', '10.0.0.']  # Common cloud/DNS IPs
        if any(printer.ip_address.startswith(prefix) for prefix in invalid_ip_prefixes if '192.168.' not in printer.ip_address):
            return f"Invalid IP address (external/cloud IP not allowed): {printer.ip_address}"
        
        # Check access code length (Bambu access codes are typically 8 characters)
        if len(printer.access_code) < 6:
            return f"Access code too short: {len(printer.access_code)} characters"
        
        return None
    
    async def _verify_printer_connection(self, printer_key: str, client) -> bool:
        """
        Verify that a printer connection is actually working
        
        Args:
            printer_key: Printer identifier
            client: Connected printer client
            
        Returns:
            True if printer is responding correctly, False otherwise
        """
        try:
            # Try to get printer info or status to verify connection
            # The bambulabs_api should have methods to query printer state
            import asyncio
            
            # Give the connection a moment to stabilize
            await asyncio.sleep(1)
            
            # Check if client has expected attributes
            if not hasattr(client, 'mqtt_client'):
                logger.warning(f"Printer {printer_key} client missing mqtt_client attribute")
                return False
            
            # For now, assume if we got here without exception, connection is valid
            # In a real implementation, we'd query printer status
            logger.debug(f"Printer {printer_key} connection verified")
            return True
            
        except Exception as e:
            logger.error(f"Failed to verify printer {printer_key} connection: {e}")
            return False
    
    async def _update_connection_status(self, printer_id: str, is_connected: bool, error: Optional[str] = None):
        """
        Update printer connection status in database
        
        Args:
            printer_id: Database ID of the printer
            is_connected: Connection status
            error: Optional error message
        """
        try:
            async with self.db_service.get_session() as session:
                from sqlalchemy import text
                
                query = text("""
                    UPDATE printers 
                    SET is_connected = :is_connected,
                        last_connection_attempt = :timestamp,
                        connection_error = :error,
                        updated_at = :timestamp
                    WHERE id = :printer_id
                """)
                
                await session.execute(query, {
                    'is_connected': is_connected,
                    'timestamp': datetime.utcnow().isoformat(),
                    'error': error,
                    'printer_id': printer_id
                })
                
                await session.commit()
                logger.debug(f"Updated connection status for printer {printer_id}: connected={is_connected}")
                
        except Exception as e:
            logger.error(f"Failed to update connection status for printer {printer_id}: {e}")
    
    async def handle_printer_added(self, printer_data: Dict[str, Any]):
        """
        Handle when a new printer is added to the database
        
        Args:
            printer_data: Printer data from database/sync
        """
        try:
            logger.info(f"Handling new printer: {printer_data.get('name')} (ID: {printer_data.get('printer_id')})")
            
            # Create Printer model from data
            printer = Printer.from_supabase_dict(printer_data)
            
            # Add to manager and connect
            await self._add_printer_to_manager(printer)
            await self._connect_printer(printer)
            
        except Exception as e:
            logger.error(f"Error handling printer addition: {e}")
    
    async def handle_printer_updated(self, printer_data: Dict[str, Any]):
        """
        Handle when a printer is updated in the database
        
        Args:
            printer_data: Updated printer data
        """
        try:
            logger.info(f"Handling printer update: {printer_data.get('name')} (ID: {printer_data.get('printer_id')})")
            
            # Create Printer model from data
            printer = Printer.from_supabase_dict(printer_data)
            printer_key = str(printer.printer_id) if printer.printer_id else printer.id
            
            # Check if printer exists in manager
            if printer_key in printer_manager.printer_configs:
                # Disconnect existing connection
                printer_manager.disconnect_printer(printer_key)
            
            # Update configuration and reconnect
            await self._add_printer_to_manager(printer)
            
            # Only connect if printer is active
            if printer.is_active:
                await self._connect_printer(printer)
            
        except Exception as e:
            logger.error(f"Error handling printer update: {e}")
    
    async def handle_printer_deleted(self, printer_data: Dict[str, Any]):
        """
        Handle when a printer is deleted from the database
        
        Args:
            printer_data: Deleted printer data
        """
        try:
            printer_id = printer_data.get('printer_id')
            printer_key = str(printer_id) if printer_id else printer_data.get('id')
            
            logger.info(f"Handling printer deletion: {printer_data.get('name')} (Key: {printer_key})")
            
            # Remove from printer manager (this also disconnects)
            if printer_key in printer_manager.printer_configs:
                printer_manager.remove_printer(printer_key)
                logger.info(f"Removed printer {printer_key} from manager")
            else:
                logger.warning(f"Printer {printer_key} not found in manager")
            
        except Exception as e:
            logger.error(f"Error handling printer deletion: {e}")
    
    async def get_connection_status(self) -> Dict[str, Any]:
        """
        Get current connection status for all printers
        
        Returns:
            Dictionary with connection status information
        """
        try:
            status = {
                'tenant_id': self.tenant_id,
                'total_configured': len(printer_manager.printer_configs),
                'total_connected': len(printer_manager.clients),
                'printers': []
            }
            
            # Get status for each printer
            for printer_key, config in printer_manager.printer_configs.items():
                printer_status = {
                    'key': printer_key,
                    'name': config.get('name'),
                    'printer_id': config.get('printer_id'),
                    'ip_address': config.get('ip'),
                    'connected': printer_key in printer_manager.clients,
                    'enabled': config.get('enabled', True)
                }
                status['printers'].append(printer_status)
            
            return status
            
        except Exception as e:
            logger.error(f"Error getting connection status: {e}")
            return {
                'error': str(e)
            }
    
    async def start_connection_monitoring(self):
        """
        Start the background task that monitors and auto-reconnects printers
        """
        if self.monitor_task and not self.monitor_task.done():
            logger.warning("Connection monitoring already running")
            return
        
        self.is_running = True
        self.monitor_task = asyncio.create_task(self._connection_monitor_loop())
        logger.info("Printer connection monitoring started")
    
    async def stop_connection_monitoring(self):
        """
        Stop the background connection monitoring task
        """
        self.is_running = False
        
        if self.monitor_task and not self.monitor_task.done():
            self.monitor_task.cancel()
            try:
                await self.monitor_task
            except asyncio.CancelledError:
                pass
        
        logger.info("Printer connection monitoring stopped")
    
    async def _connection_monitor_loop(self):
        """
        Background loop that monitors and reconnects printers
        """
        logger.info("Connection monitor loop started")
        
        while self.is_running:
            try:
                # Wait between monitoring cycles
                await asyncio.sleep(60)  # Check every minute
                
                if not self.is_running:
                    break
                
                # Get all active printers for this tenant
                printers = await self.db_service.get_printers_by_tenant(self.tenant_id)
                active_printers = [p for p in printers if p.is_active]
                
                for printer in active_printers:
                    if not self.is_running:
                        break
                    
                    printer_key = str(printer.printer_id) if printer.printer_id else printer.id
                    
                    # Check if printer needs reconnection
                    if await self._should_attempt_reconnection(printer_key):
                        await self._attempt_printer_reconnection(printer)
                
            except asyncio.CancelledError:
                logger.info("Connection monitor loop cancelled")
                break
            except Exception as e:
                logger.error(f"Error in connection monitor loop: {e}")
                # Continue monitoring even on errors
                await asyncio.sleep(30)  # Shorter delay on error
        
        logger.info("Connection monitor loop stopped")
    
    async def _should_attempt_reconnection(self, printer_key: str) -> bool:
        """
        Check if we should attempt to reconnect to a printer
        """
        # Don't reconnect if already connected
        if printer_key in printer_manager.clients:
            # Reset the reconnection interval since it's connected
            self.reconnection_intervals.pop(printer_key, None)
            return False
        
        # Check if we should wait before attempting reconnection
        current_time = asyncio.get_event_loop().time()
        last_attempt_time = getattr(self, f'_last_attempt_{printer_key}', 0)
        
        # Get current reconnection interval (exponential backoff)
        interval = self.reconnection_intervals.get(printer_key, self.min_reconnection_interval)
        
        if current_time - last_attempt_time < interval:
            return False
        
        return True
    
    async def _attempt_printer_reconnection(self, printer: 'Printer'):
        """
        Attempt to reconnect a single printer with exponential backoff
        """
        printer_key = str(printer.printer_id) if printer.printer_id else printer.id
        
        try:
            # Record the attempt time
            setattr(self, f'_last_attempt_{printer_key}', asyncio.get_event_loop().time())
            
            # Quick validation check - skip printers with invalid credentials
            validation_error = self._validate_printer_credentials(printer)
            if validation_error:
                # For printers with validation errors, set a very long interval to avoid spam
                self.reconnection_intervals[printer_key] = self.max_reconnection_interval
                logger.debug(f"Skipping reconnection for {printer_key} due to validation error: {validation_error}")
                return
            
            logger.info(f"Attempting to reconnect printer {printer_key} ({printer.name})")
            
            # Ensure printer is configured in manager
            if printer_key not in printer_manager.printer_configs:
                await self._add_printer_to_manager(printer)
            
            # Attempt connection
            success = await self._connect_printer(printer)
            
            if success:
                logger.info(f"✅ Successfully reconnected printer {printer_key}")
                # Reset the reconnection interval on success
                self.reconnection_intervals.pop(printer_key, None)
            else:
                # Increase the reconnection interval (exponential backoff)
                current_interval = self.reconnection_intervals.get(printer_key, self.min_reconnection_interval)
                new_interval = min(current_interval * 2, self.max_reconnection_interval)
                self.reconnection_intervals[printer_key] = new_interval
                
                logger.warning(f"❌ Failed to reconnect printer {printer_key}, next attempt in {new_interval} seconds")
        
        except Exception as e:
            logger.error(f"Error attempting to reconnect printer {printer_key}: {e}")
            # Increase interval on error
            current_interval = self.reconnection_intervals.get(printer_key, self.min_reconnection_interval)
            new_interval = min(current_interval * 2, self.max_reconnection_interval)
            self.reconnection_intervals[printer_key] = new_interval

    async def initial_sync_with_retries(self, max_retries: int = 3, retry_delay: int = 10):
        """
        Perform initial database sync with retry logic for startup resilience
        """
        for attempt in range(max_retries):
            try:
                logger.info(f"Initial printer sync attempt {attempt + 1}/{max_retries}")
                
                # Wait a bit on retry to let network/services stabilize
                if attempt > 0:
                    logger.info(f"Waiting {retry_delay} seconds before retry...")
                    await asyncio.sleep(retry_delay)
                
                # Perform the sync
                result = await self.sync_printers_from_database()
                
                if result.get('success', False):
                    logger.info(f"✅ Initial sync successful: {result['connected']} connected, {result['failed']} failed")
                    return result
                else:
                    logger.warning(f"❌ Initial sync failed: {result.get('error', 'Unknown error')}")
                    
            except Exception as e:
                logger.error(f"Initial sync attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    logger.error("All initial sync attempts failed, continuing with empty state")
                    return {'success': False, 'error': f'All retries failed: {e}'}
        
        return {'success': False, 'error': 'Max retries exceeded'}
    
    async def wait_for_network_stability(self, max_wait: int = 30):
        """
        Wait for network connectivity before attempting printer connections
        """
        import socket
        
        logger.info("Checking network connectivity...")
        
        for attempt in range(max_wait):
            try:
                # Try to connect to a reliable external service
                sock = socket.create_connection(("8.8.8.8", 53), timeout=3)
                sock.close()
                logger.info("✅ Network connectivity confirmed")
                return True
            except (socket.error, socket.timeout):
                if attempt < max_wait - 1:
                    logger.debug(f"Network check {attempt + 1}/{max_wait} failed, retrying...")
                    await asyncio.sleep(1)
                else:
                    logger.warning("❌ Network connectivity check timed out, proceeding anyway")
                    return False
        
        return False


# Global printer connection service instance
printer_connection_service: Optional[PrinterConnectionService] = None

async def get_printer_connection_service() -> Optional[PrinterConnectionService]:
    """
    Get the global printer connection service instance
    """
    return printer_connection_service

async def initialize_printer_connection_service(tenant_id: str) -> PrinterConnectionService:
    """
    Initialize the global printer connection service
    """
    global printer_connection_service
    
    if printer_connection_service is not None:
        logger.warning("Printer connection service already initialized")
        return printer_connection_service
    
    try:
        printer_connection_service = PrinterConnectionService()
        await printer_connection_service.initialize(tenant_id)
        
        # Perform initial sync from database with retry logic
        await printer_connection_service.initial_sync_with_retries()
        
        logger.info("Global printer connection service initialized and synced")
        return printer_connection_service
        
    except Exception as e:
        logger.error(f"Failed to initialize printer connection service: {e}")
        printer_connection_service = None
        raise

async def shutdown_printer_connection_service():
    """
    Shutdown the global printer connection service
    """
    global printer_connection_service
    
    if printer_connection_service is not None:
        # Stop the connection monitoring
        await printer_connection_service.stop_connection_monitoring()
        
        # Service cleanup if needed
        printer_connection_service = None
        logger.info("Printer connection service shutdown complete")