"""
Sync service for managing Supabase Realtime synchronization

SIMPLIFIED VERSION FOR LOCAL-FIRST ARCHITECTURE:
- Local SQLite is the source of truth for all operational data
- Supabase serves as backup only (no restoration)
- No initial sync from Supabase to prevent data restoration issues
"""

import asyncio
import logging
import os
from typing import Dict, Any, Optional, Callable
from datetime import datetime

from supabase import create_client, Client

from .database_service import get_database_service, DatabaseService
from .auth_service import get_auth_service

logger = logging.getLogger(__name__)

class SyncService:
    """
    Service for managing real-time synchronization between Supabase and local database
    
    SIMPLIFIED FOR LOCAL-FIRST ARCHITECTURE:
    - No initial sync from Supabase (prevents restored deleted data)
    - No real-time sync from Supabase (local is source of truth)
    - Backup service handles one-way sync TO Supabase
    """
    
    def __init__(self, tenant_id: str, supabase_url: str, supabase_key: str):
        """
        Initialize sync service
        
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
        self.connection_retries = 0
        self.max_retries = 5
        self.retry_delay = 5  # seconds
        
        # Authentication recovery state
        self._auth_recovery_attempts = 0
        self._max_auth_recovery_attempts = 3
        self._auth_recovery_delay = 10  # seconds
        self._last_auth_recovery = None
        self._stored_credentials = None  # Store credentials for auth recovery
        
        # Database service
        self.db_service: Optional[DatabaseService] = None
        
        logger.info(f"Sync service initialized for tenant {tenant_id} (LOCAL-FIRST ARCHITECTURE)")
    
    async def _get_authenticated_client(self) -> Client:
        """
        Get an authenticated Supabase client for API calls with automatic recovery
        
        Returns:
            Authenticated client if available, otherwise anonymous client
        """
        auth_service = get_auth_service()
        
        if auth_service:
            if auth_service.is_authenticated():
                # Use authenticated client for better RLS access
                authenticated_client = auth_service.get_sync_compatible_client()
                if authenticated_client:
                    logger.debug("Using authenticated Supabase client for API calls")
                    return authenticated_client
                else:
                    logger.warning("Auth service authenticated but no client available")
            else:
                logger.info("Auth service not authenticated, attempting recovery")
                # Try automatic authentication recovery
                if await self._attempt_auth_recovery():
                    authenticated_client = auth_service.get_sync_compatible_client()
                    if authenticated_client:
                        logger.info("Authentication recovery successful, using authenticated client")
                        return authenticated_client
        else:
            logger.error("Auth service not available - this is a critical error")
        
        # Fallback to anonymous client
        logger.info("Using anonymous Supabase client for API calls")
        return self.supabase
    
    async def _attempt_auth_recovery(self) -> bool:
        """
        Attempt to recover authentication automatically
        
        Returns:
            True if recovery successful, False otherwise
        """
        try:
            now = datetime.utcnow()
            
            # Check if we've exceeded max recovery attempts
            if self._auth_recovery_attempts >= self._max_auth_recovery_attempts:
                if self._last_auth_recovery and (now - self._last_auth_recovery).total_seconds() < 3600:  # 1 hour
                    logger.warning(f"Max auth recovery attempts ({self._max_auth_recovery_attempts}) exceeded, waiting before retry")
                    return False
                else:
                    # Reset after 1 hour
                    logger.info("Resetting auth recovery attempts after timeout")
                    self._auth_recovery_attempts = 0
            
            # Check rate limiting
            if self._last_auth_recovery and (now - self._last_auth_recovery).total_seconds() < self._auth_recovery_delay:
                logger.debug("Auth recovery rate limited")
                return False
            
            self._auth_recovery_attempts += 1
            self._last_auth_recovery = now
            
            logger.info(f"Attempting authentication recovery (attempt {self._auth_recovery_attempts}/{self._max_auth_recovery_attempts})")
            
            auth_service = get_auth_service()
            if not auth_service:
                logger.error("Auth service not available for recovery")
                return False
            
            # Try to recover using stored credentials or refresh token
            recovery_result = await auth_service.ensure_authenticated_or_reauth(
                email=self._stored_credentials.get('email') if self._stored_credentials else None,
                password=self._stored_credentials.get('password') if self._stored_credentials else None
            )
            
            if recovery_result['success']:
                logger.info(f"Auth recovery successful: {recovery_result.get('action')}")
                self._auth_recovery_attempts = 0  # Reset on success
                return True
            else:
                logger.warning(f"Auth recovery failed: {recovery_result.get('error')}")
                return False
                
        except Exception as e:
            logger.error(f"Error in auth recovery: {e}")
            return False
    
    def store_credentials_for_recovery(self, email: str, password: str):
        """
        Store credentials for automatic authentication recovery
        
        Args:
            email: User email
            password: User password
        """
        # In production, these should be encrypted
        self._stored_credentials = {
            'email': email,
            'password': password
        }
        logger.info("Credentials stored for authentication recovery")
    
    async def initialize(self):
        """
        Initialize the sync service
        """
        try:
            # Get database service
            self.db_service = await get_database_service()
            
            logger.info("Sync service initialized successfully (LOCAL-FIRST MODE)")
            
        except Exception as e:
            logger.error(f"Failed to initialize sync service: {e}")
            raise
    
    async def start(self):
        """
        Start the sync service
        
        LOCAL-FIRST ARCHITECTURE:
        - No initial sync from Supabase (prevents data restoration)
        - No real-time sync from Supabase (local is source of truth)
        - Backup service handles one-way sync TO Supabase
        """
        if self.is_running:
            logger.warning("Sync service is already running")
            return
        
        try:
            logger.info("🚀 Starting sync service in LOCAL-FIRST mode")
            logger.info("📋 Local SQLite is the source of truth")
            logger.info("☁️ Supabase serves as backup only")
            logger.info("🚫 No initial sync from Supabase (prevents data restoration)")
            logger.info("🚫 No real-time sync from Supabase (local is authoritative)")
            
            self.is_running = True
            logger.info("✅ Sync service started successfully (LOCAL-FIRST)")
            
        except Exception as e:
            logger.error(f"Failed to start sync service: {e}")
            # Try to clean up
            await self.stop()
            raise
    
    async def stop(self):
        """
        Stop the sync service
        """
        self.is_running = False
        logger.info("✅ Sync service stopped (LOCAL-FIRST)")
    
    async def perform_initial_sync(self):
        """
        Perform initial synchronization of all data
        
        LOCAL-FIRST ARCHITECTURE: This method is disabled to prevent data restoration.
        Local SQLite is the source of truth. Supabase serves as backup only.
        """
        logger.info("🚫 Initial sync DISABLED for local-first architecture")
        logger.info("📋 Local SQLite is the source of truth")
        logger.info("☁️ Supabase serves as backup only via backup_service")
        logger.info("✅ No data restoration from Supabase (prevents deleted job reappearance)")
        
        # If you need to restore from backup in the future, create a separate 
        # "restore_from_backup" method that can be called explicitly
    
    async def force_resync(self):
        """
        Force a complete resynchronization - DISABLED for local-first architecture
        """
        logger.info("🚫 Force resync DISABLED for local-first architecture")
        logger.info("📋 Local SQLite is the source of truth - no resync needed")
        logger.info("💡 To restore from backup, implement explicit restore_from_backup method")
    
    async def get_sync_status(self) -> Dict[str, Any]:
        """
        Get current synchronization status
        """
        return {
            "is_running": self.is_running,
            "tenant_id": self.tenant_id,
            "architecture": "local-first",
            "local_is_source_of_truth": True,
            "supabase_role": "backup_only",
            "initial_sync_enabled": False,
            "realtime_sync_enabled": False,
            "backup_sync_enabled": True,
            "connection_retries": self.connection_retries,
            "max_retries": self.max_retries,
            "last_check": datetime.utcnow().isoformat()
        }


# Global sync service instance
sync_service: Optional[SyncService] = None


async def get_sync_service() -> Optional[SyncService]:
    """Get the global sync service instance"""
    return sync_service


async def initialize_sync_service(tenant_id: str, supabase_url: str, supabase_key: str) -> SyncService:
    """
    Initialize and start the global sync service
    """
    global sync_service
    
    try:
        logger.info(f"Initializing sync service for tenant {tenant_id} (LOCAL-FIRST)")
        sync_service = SyncService(tenant_id, supabase_url, supabase_key)
        await sync_service.initialize()
        await sync_service.start()
        logger.info(f"✅ Sync service initialized and started (LOCAL-FIRST)")
        return sync_service
        
    except Exception as e:
        logger.error(f"Failed to initialize sync service: {e}")
        sync_service = None
        raise


async def shutdown_sync_service():
    """
    Shutdown the global sync service
    """
    global sync_service
    
    if sync_service:
        try:
            logger.info("Shutting down sync service...")
            await sync_service.stop()
            sync_service = None
            logger.info("✅ Sync service shutdown complete")
            
        except Exception as e:
            logger.error(f"Error shutting down sync service: {e}")
    else:
        logger.info("No sync service to shutdown")