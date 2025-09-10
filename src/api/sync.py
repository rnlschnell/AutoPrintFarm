"""
Sync monitoring and management endpoints
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Dict, Any
import logging
from datetime import datetime

from ..services.sync_service import get_sync_service
from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.auth_service import get_auth_service
from ..services.printer_connection_service import get_printer_connection_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Sync Management"])

# Request models
class AuthRecoveryRequest(BaseModel):
    email: EmailStr
    password: str

@router.get("/status", response_model=Dict[str, Any])
async def get_sync_status():
    """
    Get current synchronization status
    
    Returns detailed information about the sync service status,
    database statistics, and recent sync activity.
    """
    try:
        # Get sync service status
        sync_service = await get_sync_service()
        if sync_service:
            sync_status = await sync_service.get_sync_status()
        else:
            sync_status = {
                'is_running': False,
                'error': 'Sync service not initialized'
            }
        
        # Get database service status
        try:
            db_service = await get_database_service()
            db_stats = await db_service.get_sync_stats()
        except Exception as e:
            db_stats = {'error': str(e)}
        
        # Get configuration status
        config_service = get_config_service()
        config_validation = config_service.validate_config()
        
        return {
            'sync_service': sync_status,
            'database': db_stats,
            'configuration': {
                'valid': config_validation['valid'],
                'tenant_configured': config_service.is_tenant_configured(),
                'tenant_id': config_service.get_tenant_id(),
                'issues': config_validation.get('issues', []),
                'warnings': config_validation.get('warnings', [])
            },
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error getting sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/force-resync", response_model=Dict[str, Any])
async def force_resync():
    """
    Force a complete resynchronization - DISABLED for local-first architecture
    
    LOCAL-FIRST ARCHITECTURE: Resync from Supabase is disabled to prevent
    restoration of deleted data. Local SQLite is the source of truth.
    """
    try:
        sync_service = await get_sync_service()
        if not sync_service:
            raise HTTPException(status_code=503, detail="Sync service not available")
        
        # Call the disabled force_resync method (it will log and do nothing)
        await sync_service.force_resync()
        
        return {
            'success': True,
            'message': 'Local-first architecture: resync from Supabase disabled. Local SQLite is source of truth.',
            'architecture': 'local-first',
            'supabase_resync_disabled': True,
            'reason': 'Prevents restoration of deleted data',
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during forced resync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health", response_model=Dict[str, Any])
async def get_sync_health():
    """
    Get sync service health check
    
    Returns a simple health check for monitoring systems.
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            return {
                'status': 'unhealthy',
                'reason': 'Sync service not initialized',
                'timestamp': datetime.utcnow().isoformat()
            }
        
        if not sync_service.is_running:
            return {
                'status': 'unhealthy',
                'reason': 'Sync service not running',
                'timestamp': datetime.utcnow().isoformat()
            }
        
        # Check database connectivity
        try:
            db_service = await get_database_service()
            await db_service.get_sync_stats()  # Simple query to test DB
        except Exception as e:
            return {
                'status': 'unhealthy',
                'reason': f'Database connectivity issue: {str(e)}',
                'timestamp': datetime.utcnow().isoformat()
            }
        
        return {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error in sync health check: {e}")
        return {
            'status': 'unhealthy',
            'reason': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }

@router.get("/config", response_model=Dict[str, Any])
async def get_sync_config():
    """
    Get current sync configuration
    
    Returns the current sync configuration without sensitive data.
    """
    try:
        config_service = get_config_service()
        
        # Get all relevant config sections
        tenant_config = config_service.get_tenant_config()
        sync_config = config_service.get_sync_config()
        database_config = config_service.get_database_config()
        supabase_config = config_service.get_supabase_config()
        
        # Sanitize sensitive information
        sanitized_supabase = {
            'url': supabase_config.get('url', ''),
            'has_anon_key': bool(supabase_config.get('anon_key', '')),
            'has_service_key': bool(supabase_config.get('service_role_key', ''))
        }
        
        return {
            'tenant': {
                'id': tenant_config.get('id', ''),
                'name': tenant_config.get('name', ''),
                'configured': bool(tenant_config.get('id', ''))
            },
            'sync': sync_config,
            'database': database_config,
            'supabase': sanitized_supabase,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error getting sync config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config/tenant", response_model=Dict[str, Any])
async def set_tenant_config(tenant_id: str, tenant_name: str = None):
    """
    Set tenant configuration
    
    Configures the tenant ID and optionally the tenant name.
    This operation requires restart to take effect.
    
    Args:
        tenant_id: The tenant UUID
        tenant_name: Optional tenant/company name
    """
    try:
        config_service = get_config_service()
        
        # Validate tenant ID format (basic UUID check)
        if len(tenant_id.strip()) < 32:
            raise HTTPException(status_code=400, detail="Invalid tenant ID format")
        
        # Set tenant configuration
        success = config_service.set_tenant_info(tenant_id.strip(), tenant_name)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save tenant configuration")
        
        return {
            'success': True,
            'message': 'Tenant configuration updated successfully',
            'tenant_id': tenant_id.strip(),
            'tenant_name': tenant_name,
            'restart_required': True,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting tenant config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs", response_model=Dict[str, Any])
async def get_sync_logs(limit: int = 50, status: str = None):
    """
    Get recent sync operation logs
    
    Args:
        limit: Maximum number of logs to return (default 50, max 200)
        status: Filter by status (SUCCESS, FAILED, PENDING)
    """
    try:
        if limit > 200:
            limit = 200
        elif limit < 1:
            limit = 1
        
        db_service = await get_database_service()
        
        # Execute query using SQLAlchemy text
        from sqlalchemy import text
        
        async with db_service.get_session() as session:
            if status and status in ['SUCCESS', 'FAILED', 'PENDING']:
                query = text("SELECT * FROM sync_logs WHERE status = :status ORDER BY created_at DESC LIMIT :limit")
                result = await session.execute(query, {'status': status, 'limit': limit})
            else:
                query = text("SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT :limit")
                result = await session.execute(query, {'limit': limit})
            
            logs = []
            for row in result.fetchall():
                logs.append({
                    'id': row[0],
                    'operation_type': row[1],
                    'table_name': row[2],
                    'record_id': row[3],
                    'tenant_id': row[4],
                    'status': row[5],
                    'error_message': row[6],
                    'created_at': row[7].isoformat() if row[7] else None
                })
        
        return {
            'logs': logs,
            'count': len(logs),
            'filter': {'status': status, 'limit': limit},
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error getting sync logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/logs", response_model=Dict[str, Any])
async def cleanup_sync_logs(days_to_keep: int = 7):
    """
    Clean up old sync logs
    
    Args:
        days_to_keep: Number of days of logs to keep (default 7)
    """
    try:
        if days_to_keep < 1:
            raise HTTPException(status_code=400, detail="days_to_keep must be at least 1")
        
        db_service = await get_database_service()
        await db_service.cleanup_old_logs(days_to_keep)
        
        return {
            'success': True,
            'message': f'Cleaned up sync logs older than {days_to_keep} days',
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cleaning up logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth-recovery", response_model=Dict[str, Any])
async def sync_auth_recovery(request: AuthRecoveryRequest):
    """
    Perform authentication recovery for sync service
    
    This endpoint allows providing valid credentials to recover authentication
    for the sync service when automatic recovery fails.
    
    Args:
        request: Recovery credentials
        
    Returns:
        Recovery operation result
    """
    try:
        sync_service = await get_sync_service()
        auth_service = get_auth_service()
        
        if not sync_service or not auth_service:
            raise HTTPException(
                status_code=503,
                detail="Required services not available"
            )
        
        logger.info(f"Sync auth recovery requested for {request.email}")
        
        # Attempt authentication
        auth_result = await auth_service.authenticate_with_email(
            request.email, 
            request.password
        )
        
        if not auth_result['success']:
            return {
                'success': False,
                'message': f"Authentication failed: {auth_result.get('error')}",
                'timestamp': datetime.utcnow().isoformat()
            }
        
        # Store credentials in sync service for future recovery
        sync_service.store_credentials_for_recovery(request.email, request.password)
        
        # Note: Manual sync disabled for local-first architecture
        # Local SQLite is the source of truth, Supabase is backup only
        sync_message = "Authentication recovered successfully (sync disabled for local-first architecture)"
        success = True
        
        return {
            'success': success,
            'message': sync_message,
            'authenticated': True,
            'tenant_id': auth_result.get('tenant_id'),
            'user_id': auth_result.get('user_id'),
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Sync auth recovery failed: {e}")
        return {
            'success': False,
            'message': f"Auth recovery failed: {str(e)}",
            'timestamp': datetime.utcnow().isoformat()
        }

@router.get("/printer-connections", response_model=Dict[str, Any])
async def get_printer_connections():
    """
    Get detailed printer connection status
    
    Returns detailed information about each printer's connection status,
    including validation errors and connection attempts.
    """
    try:
        # Get connection service status
        connection_service = await get_printer_connection_service()
        if connection_service:
            connection_status = await connection_service.get_connection_status()
        else:
            connection_status = {
                'error': 'Printer connection service not initialized'
            }
        
        # Get database printers with connection status
        config_service = get_config_service()
        tenant_id = config_service.get_tenant_id()
        
        if tenant_id:
            db_service = await get_database_service()
            printers = await db_service.get_printers_by_tenant(tenant_id)
            
            # Build detailed status for each printer
            printer_details = []
            for printer in printers:
                printer_id_str = str(printer.printer_id) if printer.printer_id else printer.id
                
                # Find connection info from service
                conn_info = None
                if 'printers' in connection_status:
                    conn_info = next((p for p in connection_status['printers'] if p['key'] == printer_id_str), None)
                
                printer_details.append({
                    'printer_id': printer.printer_id,
                    'name': printer.name,
                    'database_id': printer.id,
                    'ip_address': printer.ip_address,
                    'serial_number': printer.serial_number,
                    'has_access_code': bool(printer.access_code),
                    'is_active': printer.is_active,
                    'is_connected_db': printer.is_connected,
                    'is_connected_actual': conn_info['connected'] if conn_info else False,
                    'connection_error': printer.connection_error,
                    'last_connection_attempt': printer.last_connection_attempt.isoformat() if printer.last_connection_attempt else None
                })
            
            return {
                'tenant_id': tenant_id,
                'total_printers': len(printer_details),
                'connected_count': sum(1 for p in printer_details if p['is_connected_actual']),
                'printers': printer_details,
                'connection_service': connection_status,
                'timestamp': datetime.utcnow().isoformat()
            }
        else:
            return {
                'error': 'No tenant configured',
                'timestamp': datetime.utcnow().isoformat()
            }
        
    except Exception as e:
        logger.error(f"Error getting printer connections: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test-printer/{printer_id}", response_model=Dict[str, Any])
async def test_printer_connection(printer_id: int):
    """
    Test connection to a specific printer
    
    Args:
        printer_id: The Supabase printer_id to test
        
    Returns:
        Detailed test results including validation and connection status
    """
    try:
        config_service = get_config_service()
        tenant_id = config_service.get_tenant_id()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="No tenant configured")
        
        # Get printer from database
        db_service = await get_database_service()
        printers = await db_service.get_printers_by_tenant(tenant_id)
        printer = next((p for p in printers if p.printer_id == printer_id), None)
        
        if not printer:
            raise HTTPException(status_code=404, detail=f"Printer with ID {printer_id} not found")
        
        # Get connection service
        connection_service = await get_printer_connection_service()
        if not connection_service:
            raise HTTPException(status_code=503, detail="Printer connection service not available")
        
        # Perform validation
        validation_error = connection_service._validate_printer_credentials(printer)
        
        # Attempt connection if validation passes
        connection_result = False
        connection_error = None
        
        if not validation_error:
            try:
                connection_result = await connection_service._connect_printer(printer)
            except Exception as e:
                connection_error = str(e)
        
        return {
            'printer_id': printer_id,
            'name': printer.name,
            'validation': {
                'passed': validation_error is None,
                'error': validation_error
            },
            'connection': {
                'success': connection_result,
                'error': connection_error
            },
            'details': {
                'ip_address': printer.ip_address,
                'serial_number': printer.serial_number,
                'has_access_code': bool(printer.access_code),
                'access_code_length': len(printer.access_code) if printer.access_code else 0
            },
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing printer connection: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/resync-printer-connections", response_model=Dict[str, Any])
async def resync_printer_connections():
    """
    Force resync of all printer connections from database
    
    This will re-validate and attempt to connect all printers
    based on current database state.
    """
    try:
        connection_service = await get_printer_connection_service()
        if not connection_service:
            raise HTTPException(status_code=503, detail="Printer connection service not available")
        
        # Perform resync
        result = await connection_service.sync_printers_from_database()
        
        return {
            'success': result.get('success', False),
            'message': 'Printer connections resynced',
            'results': result,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resyncing printer connections: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/local-printers", response_model=Dict[str, Any])
async def get_local_printers():
    """
    Get printers from local database
    
    Returns all active printers stored in the local SQLite database.
    """
    try:
        config_service = get_config_service()
        tenant_id = config_service.get_tenant_id()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        db_service = await get_database_service()
        printers = await db_service.get_printers_by_tenant(tenant_id)
        
        # Convert to dictionaries
        printer_data = [printer.to_dict() for printer in printers]
        
        return {
            'printers': printer_data,
            'count': len(printer_data),
            'tenant_id': tenant_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting local printers: {e}")
        raise HTTPException(status_code=500, detail=str(e))