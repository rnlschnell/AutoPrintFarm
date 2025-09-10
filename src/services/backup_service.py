"""
Backup service for syncing local SQLite data to Supabase
Handles one-way sync from local to cloud for backup purposes
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from supabase import create_client, Client
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import (
    Printer, ColorPreset, Product, ProductSku, 
    PrintFile, PrintJob, BackupQueue
)
from .database_service import get_database_service, DatabaseService
from .auth_service import get_auth_service

logger = logging.getLogger(__name__)

class BackupService:
    """
    Service for backing up local SQLite data to Supabase
    """
    
    def __init__(self, tenant_id: str, supabase_url: str, supabase_key: str):
        """
        Initialize backup service
        
        Args:
            tenant_id: The tenant ID this Pi is associated with
            supabase_url: Supabase project URL
            supabase_key: Supabase anonymous key
        """
        self.tenant_id = tenant_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        
        # Initialize Supabase client
        self.supabase: Client = create_client(supabase_url, supabase_key)
        
        # Service state
        self.is_running = False
        self.backup_interval = 300  # 5 minutes
        self.backup_task = None
        self.last_backup = None
        self.backup_stats = {
            'total_backups': 0,
            'successful_backups': 0,
            'failed_backups': 0,
            'last_error': None
        }
        
        # Database service
        self.db_service: Optional[DatabaseService] = None
        
        # Tables to backup
        self.backup_tables = [
            'printers', 'color_presets', 'products', 
            'product_skus', 'print_files', 'print_jobs'
        ]
        
        logger.info(f"Backup service initialized for tenant {tenant_id}")
    
    async def initialize(self):
        """Initialize the backup service"""
        try:
            # Get database service
            self.db_service = await get_database_service()
            
            # Create backup queue table if it doesn't exist
            await self._ensure_backup_queue_table()
            
            logger.info("Backup service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize backup service: {e}")
            raise
    
    async def _ensure_backup_queue_table(self):
        """Ensure backup queue table exists in SQLite"""
        try:
            async with self.db_service.get_session() as session:
                # Check if table exists, create if not
                await session.execute("""
                    CREATE TABLE IF NOT EXISTS backup_queue (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        table_name TEXT NOT NULL,
                        operation TEXT NOT NULL,
                        record_id TEXT NOT NULL,
                        record_data TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        processed BOOLEAN DEFAULT FALSE,
                        processed_at TIMESTAMP,
                        error TEXT,
                        retry_count INTEGER DEFAULT 0
                    )
                """)
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to ensure backup queue table: {e}")
            raise
    
    async def start(self):
        """Start the backup service"""
        if self.is_running:
            logger.warning("Backup service is already running")
            return
        
        try:
            self.is_running = True
            
            # Start periodic backup task
            self.backup_task = asyncio.create_task(self._backup_loop())
            
            logger.info("Backup service started successfully")
            
        except Exception as e:
            logger.error(f"Failed to start backup service: {e}")
            self.is_running = False
            raise
    
    async def stop(self):
        """Stop the backup service"""
        self.is_running = False
        
        try:
            # Cancel backup task
            if self.backup_task:
                self.backup_task.cancel()
                try:
                    await self.backup_task
                except asyncio.CancelledError:
                    pass
            
            # Do one final backup before stopping
            await self.perform_backup()
            
            logger.info("Backup service stopped")
            
        except Exception as e:
            logger.error(f"Error stopping backup service: {e}")
    
    async def _backup_loop(self):
        """Main backup loop that runs periodically"""
        while self.is_running:
            try:
                # Perform backup
                await self.perform_backup()
                
                # Wait for next interval
                await asyncio.sleep(self.backup_interval)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in backup loop: {e}")
                # Wait before retrying
                await asyncio.sleep(30)
    
    async def perform_backup(self):
        """Perform backup of all local tables to Supabase"""
        logger.info("Starting backup to Supabase...")
        self.backup_stats['total_backups'] += 1
        
        try:
            # Get authenticated client if available
            auth_service = get_auth_service()
            headers = {}
            
            if auth_service and auth_service.is_authenticated():
                access_token = auth_service.get_access_token()
                headers = {
                    'Authorization': f'Bearer {access_token}',
                    'apikey': self.supabase_key
                }
                logger.debug("Using authenticated client for backup")
            else:
                logger.debug("Using anonymous client for backup")
            
            # Backup each table
            for table_name in self.backup_tables:
                await self._backup_table(table_name, headers)
            
            # Process backup queue for any failed items
            await self._process_backup_queue(headers)
            
            self.last_backup = datetime.utcnow()
            self.backup_stats['successful_backups'] += 1
            logger.info(f"Backup completed successfully at {self.last_backup}")
            
        except Exception as e:
            self.backup_stats['failed_backups'] += 1
            self.backup_stats['last_error'] = str(e)
            logger.error(f"Backup failed: {e}")
    
    async def _backup_table(self, table_name: str, headers: dict):
        """
        Backup a specific table to Supabase
        
        Args:
            table_name: Name of the table to backup
            headers: Authentication headers for Supabase
        """
        try:
            async with self.db_service.get_session() as session:
                # Get the model class for the table
                model_map = {
                    'printers': Printer,
                    'color_presets': ColorPreset,
                    'products': Product,
                    'product_skus': ProductSku,
                    'print_files': PrintFile,
                    'print_jobs': PrintJob
                }
                
                model_class = model_map.get(table_name)
                if not model_class:
                    logger.warning(f"Unknown table for backup: {table_name}")
                    return
                
                # Get all records from local SQLite
                result = await session.execute(
                    select(model_class)
                )
                records = result.scalars().all()
                
                if not records:
                    logger.debug(f"No records to backup in {table_name}")
                    return
                
                # Convert records to dict and add tenant_id
                backup_data = []
                for record in records:
                    record_dict = {
                        col.name: getattr(record, col.name)
                        for col in model_class.__table__.columns
                    }
                    # Ensure tenant_id is always included
                    record_dict['tenant_id'] = self.tenant_id
                    
                    # Convert datetime objects to ISO format
                    for key, value in record_dict.items():
                        if isinstance(value, datetime):
                            record_dict[key] = value.isoformat()
                    
                    backup_data.append(record_dict)
                
                # Upsert to Supabase (insert or update if exists)
                response = self.supabase.table(table_name).upsert(
                    backup_data,
                    on_conflict='id'  # Use id as the conflict column
                ).execute()
                
                logger.info(f"Backed up {len(backup_data)} records from {table_name}")
                
        except Exception as e:
            logger.error(f"Failed to backup table {table_name}: {e}")
            # Add to backup queue for retry
            await self._add_to_backup_queue(table_name, 'backup', str(e))
    
    async def _add_to_backup_queue(self, table_name: str, operation: str, error: str):
        """
        Add failed operation to backup queue for retry
        
        Args:
            table_name: Table that failed to backup
            operation: Operation type (backup, insert, update, delete)
            error: Error message
        """
        try:
            async with self.db_service.get_session() as session:
                await session.execute("""
                    INSERT INTO backup_queue (table_name, operation, record_id, record_data, error)
                    VALUES (?, ?, ?, ?, ?)
                """, (table_name, operation, 'batch', '{}', error))
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to add to backup queue: {e}")
    
    async def _process_backup_queue(self, headers: dict):
        """
        Process any items in the backup queue
        
        Args:
            headers: Authentication headers for Supabase
        """
        try:
            async with self.db_service.get_session() as session:
                # Get unprocessed items from queue
                result = await session.execute("""
                    SELECT * FROM backup_queue 
                    WHERE processed = FALSE AND retry_count < 3
                    ORDER BY created_at
                    LIMIT 100
                """)
                
                queue_items = result.fetchall()
                
                for item in queue_items:
                    # Retry the backup operation
                    # (Implementation depends on specific requirements)
                    pass
                    
        except Exception as e:
            logger.error(f"Failed to process backup queue: {e}")
    
    async def queue_change(self, table_name: str, operation: str, record_id: str, record_data: dict):
        """
        Queue a change for backup to Supabase
        
        Args:
            table_name: Table name
            operation: Operation type (insert, update, delete)
            record_id: Record ID
            record_data: Record data to backup
        """
        try:
            # Add tenant_id to record data
            record_data['tenant_id'] = self.tenant_id
            
            # Convert datetime objects to ISO format
            for key, value in record_data.items():
                if isinstance(value, datetime):
                    record_data[key] = value.isoformat()
            
            # Immediately try to backup to Supabase
            if operation == 'delete':
                # For deletes, just mark as inactive in Supabase
                response = self.supabase.table(table_name).update(
                    {'is_active': False, 'deleted_at': datetime.utcnow().isoformat()}
                ).eq('id', record_id).execute()
            else:
                # For insert/update, upsert the record
                response = self.supabase.table(table_name).upsert(
                    record_data,
                    on_conflict='id'
                ).execute()
            
            logger.debug(f"Successfully backed up {operation} for {table_name}:{record_id}")
            
        except Exception as e:
            logger.warning(f"Failed to immediately backup {operation} for {table_name}:{record_id}: {e}")
            # Add to queue for retry during periodic backup
            await self._add_to_backup_queue(table_name, operation, str(e))
    
    def get_backup_status(self) -> dict:
        """Get current backup service status"""
        return {
            'is_running': self.is_running,
            'last_backup': self.last_backup.isoformat() if self.last_backup else None,
            'backup_interval': self.backup_interval,
            'stats': self.backup_stats,
            'tenant_id': self.tenant_id
        }

# Global backup service instance
_backup_service: Optional[BackupService] = None

def get_backup_service() -> Optional[BackupService]:
    """Get the global backup service instance"""
    return _backup_service

async def initialize_backup_service(tenant_id: str, supabase_url: str, supabase_key: str) -> BackupService:
    """
    Initialize the global backup service
    
    Args:
        tenant_id: Tenant ID
        supabase_url: Supabase URL
        supabase_key: Supabase key
        
    Returns:
        Initialized backup service
    """
    global _backup_service
    
    if _backup_service is None:
        _backup_service = BackupService(tenant_id, supabase_url, supabase_key)
        await _backup_service.initialize()
    
    return _backup_service