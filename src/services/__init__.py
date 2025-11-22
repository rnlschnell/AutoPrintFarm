"""
Services module for PrintFarmSoftware
"""

# Import main services
from .database_service import DatabaseService, get_database_service, close_database_service
from .sync_service import SyncService, get_sync_service, initialize_sync_service, shutdown_sync_service
from .config_service import ConfigService, get_config_service
from .auth_service import AuthService, get_auth_service, initialize_auth_service
from .tunnel_service import TunnelService, get_tunnel_service, initialize_tunnel_service, shutdown_tunnel_service

# NOTE: SyncHandler removed - printers are LOCAL-ONLY (not synced to Supabase)

__all__ = [
    'DatabaseService', 'get_database_service', 'close_database_service',
    'SyncService', 'get_sync_service', 'initialize_sync_service', 'shutdown_sync_service',
    'ConfigService', 'get_config_service',
    'AuthService', 'get_auth_service', 'initialize_auth_service',
    'TunnelService', 'get_tunnel_service', 'initialize_tunnel_service', 'shutdown_tunnel_service',
]