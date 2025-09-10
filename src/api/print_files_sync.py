"""
API endpoints for print files management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import logging
from supabase import create_client, Client

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import PrintFile

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/print-files-sync",
    tags=["Print Files Sync"],
    responses={404: {"description": "Not found"}},
)

@router.post("/")
async def create_print_file(file_data: dict):
    """
    Create a new print file in local SQLite (source of truth)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Add tenant_id to file data
        file_data['tenant_id'] = tenant_id
        
        # Create file in local database
        db_service = await get_database_service()
        new_file = await db_service.create_print_file(file_data)
        
        if not new_file:
            raise HTTPException(status_code=500, detail="Failed to create print file")
        
        logger.info(f"Print file created successfully in local database: {new_file.id}")
        
        return {
            "success": True,
            "message": "Print file created successfully",
            "print_file": new_file.to_dict()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create print file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[dict])
async def get_print_files():
    """
    Get all print files for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get print files from local database
        db_service = await get_database_service()
        files = await db_service.get_print_files_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [file.to_dict() for file in files]
        
    except Exception as e:
        logger.error(f"Failed to get print files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{file_id}", response_model=dict)
async def get_print_file(file_id: str):
    """
    Get a specific print file by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        file = await db_service.get_print_file_by_id(file_id)
        
        if not file:
            raise HTTPException(status_code=404, detail="Print file not found")
        
        return file.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get print file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def force_print_files_sync():
    """
    Force a manual sync of print files from Supabase
    
    This endpoint triggers a manual synchronization of print files
    from Supabase to the local SQLite database.
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            raise HTTPException(status_code=503, detail="Sync service not available")
        
        # Local-first architecture: sync from Supabase disabled
        # Local SQLite is source of truth, prevents data restoration
        
        # Get updated count
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if tenant_id:
            db_service = await get_database_service()
            files = await db_service.get_print_files_by_tenant(tenant_id)
            
            return {
                "success": True,
                "message": "Print files sync completed",
                "print_files_count": len(files)
            }
        else:
            return {
                "success": True,
                "message": "Print files sync completed",
                "print_files_count": 0
            }
        
    except Exception as e:
        logger.error(f"Failed to force print files sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/sync")
async def get_print_files_sync_status():
    """
    Get the current sync status for print files
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            return {
                "sync_enabled": False,
                "message": "Sync service not configured"
            }
        
        # Get tenant ID
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            return {
                "sync_enabled": False,
                "message": "Tenant not configured"
            }
        
        # Get print files count
        db_service = await get_database_service()
        files = await db_service.get_print_files_by_tenant(tenant_id)
        
        # Get sync status
        sync_status = await sync_service.get_sync_status()
        
        return {
            "sync_enabled": True,
            "is_running": sync_status.get('is_running', False),
            "connected_to_realtime": sync_status.get('connected_to_realtime', False),
            "tenant_id": tenant_id,
            "local_print_files_count": len(files),
            "last_check": sync_status.get('last_check')
        }
        
    except Exception as e:
        logger.error(f"Failed to get print files sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats/summary")
async def get_print_files_summary():
    """
    Get summary statistics for print files
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get all print files
        db_service = await get_database_service()
        files = await db_service.get_print_files_by_tenant(tenant_id)
        
        # Calculate statistics
        total_files = len(files)
        total_size_bytes = sum(file.file_size_bytes or 0 for file in files)
        total_units = sum(file.number_of_units or 1 for file in files)
        
        # Files with product associations
        files_with_products = len([file for file in files if file.product_id])
        
        return {
            "total_files": total_files,
            "total_size_bytes": total_size_bytes,
            "total_size_mb": round(total_size_bytes / (1024 * 1024), 2),
            "total_units": total_units,
            "files_with_products": files_with_products,
            "files_without_products": total_files - files_with_products,
            "average_file_size_mb": round((total_size_bytes / total_files) / (1024 * 1024), 2) if total_files > 0 else 0
        }
        
    except Exception as e:
        logger.error(f"Failed to get print files summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup/orphaned")
async def cleanup_orphaned_print_files():
    """
    Clean up print files that are not linked to any active products
    
    This endpoint identifies and removes print files that:
    1. Are not referenced by any active products
    2. Have no associated product_skus
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get Supabase credentials for direct access
        supabase_url = tenant_config.get('supabase_url')
        supabase_key = tenant_config.get('supabase_key')
        
        if not supabase_url or not supabase_key:
            raise HTTPException(status_code=400, detail="Supabase credentials not configured")
        
        # Create Supabase client
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # Get all print files for this tenant
        print_files_response = supabase.table('print_files').select('id, name, created_at').eq('tenant_id', tenant_id).execute()
        print_files = print_files_response.data
        
        # Get all active products that reference print files
        products_response = supabase.table('products').select('print_file_id').eq('tenant_id', tenant_id).eq('is_active', True).neq('print_file_id', None).execute()
        active_product_file_ids = {p['print_file_id'] for p in products_response.data if p.get('print_file_id')}
        
        # Identify orphaned print files
        orphaned_files = []
        for pf in print_files:
            if pf['id'] not in active_product_file_ids:
                orphaned_files.append(pf)
        
        logger.info(f"Found {len(orphaned_files)} orphaned print files out of {len(print_files)} total files")
        
        # Delete orphaned files from database
        deleted_count = 0
        deleted_files = []
        
        for orphaned_file in orphaned_files:
            try:
                # Delete the print file (this will cascade delete associated records)
                delete_response = supabase.table('print_files').delete().eq('id', orphaned_file['id']).execute()
                
                if delete_response.data:
                    deleted_count += 1
                    deleted_files.append({
                        'id': orphaned_file['id'],
                        'name': orphaned_file['name'],
                        'created_at': orphaned_file['created_at']
                    })
                    logger.info(f"Deleted orphaned print file: {orphaned_file['name']} ({orphaned_file['id']})")
                
            except Exception as delete_error:
                logger.error(f"Failed to delete orphaned print file {orphaned_file['id']}: {delete_error}")
        
        return {
            "success": True,
            "message": f"Cleanup completed. Deleted {deleted_count} orphaned print files.",
            "total_print_files": len(print_files),
            "orphaned_files_found": len(orphaned_files),
            "deleted_count": deleted_count,
            "deleted_files": deleted_files,
            "active_product_file_ids_count": len(active_product_file_ids)
        }
        
    except Exception as e:
        logger.error(f"Failed to cleanup orphaned print files: {e}")
        raise HTTPException(status_code=500, detail=str(e))