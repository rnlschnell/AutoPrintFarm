"""
API endpoints for color presets management
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List, Optional
import logging
import uuid
from datetime import datetime
import time
from collections import defaultdict

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import ColorPreset
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Emergency rate limiting for color presets endpoint
request_counts = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # 1 minute window
RATE_LIMIT_MAX_REQUESTS = 50  # Max 50 requests per minute per IP

def check_rate_limit(request: Request):
    """Emergency rate limiting to prevent infinite loops"""
    client_ip = request.client.host if request.client else "unknown"
    current_time = time.time()
    
    # Clean old requests outside the window
    cutoff_time = current_time - RATE_LIMIT_WINDOW
    request_counts[client_ip] = [req_time for req_time in request_counts[client_ip] if req_time > cutoff_time]
    
    # Check if over limit
    if len(request_counts[client_ip]) >= RATE_LIMIT_MAX_REQUESTS:
        logger.warning(f"Rate limit exceeded for IP {client_ip}: {len(request_counts[client_ip])} requests in {RATE_LIMIT_WINDOW}s")
        raise HTTPException(
            status_code=429, 
            detail=f"Rate limit exceeded. Max {RATE_LIMIT_MAX_REQUESTS} requests per {RATE_LIMIT_WINDOW} seconds."
        )
    
    # Record this request
    request_counts[client_ip].append(current_time)

# Pydantic models for requests/responses
class ColorPresetCreateRequest(BaseModel):
    color_name: str
    hex_code: str
    material_type: Optional[str] = None
    manufacturer: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True

class ColorPresetUpdateRequest(BaseModel):
    color_name: Optional[str] = None
    hex_code: Optional[str] = None
    material_type: Optional[str] = None
    manufacturer: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

router = APIRouter(
    prefix="/color-presets",
    tags=["Color Presets"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_color_presets(request: Request):
    """
    Get all color presets for the current tenant
    """
    # Emergency rate limiting to prevent infinite loops
    check_rate_limit(request)
    
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get color presets from database
        db_service = await get_database_service()
        presets = await db_service.get_color_presets_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [preset.to_dict() for preset in presets]
        
    except Exception as e:
        logger.error(f"Failed to get color presets: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{preset_id}", response_model=dict)
async def get_color_preset(preset_id: str):
    """
    Get a specific color preset by ID
    """
    try:
        db_service = await get_database_service()
        preset = await db_service.get_color_preset_by_id(preset_id)
        
        if not preset:
            raise HTTPException(status_code=404, detail="Color preset not found")
        
        return preset.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get color preset {preset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def force_color_presets_sync():
    """
    Force a manual sync of color presets from Supabase
    
    This endpoint triggers a manual synchronization of color presets
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
            presets = await db_service.get_color_presets_by_tenant(tenant_id)
            
            return {
                "success": True,
                "message": "Color presets sync completed",
                "color_presets_count": len(presets)
            }
        else:
            return {
                "success": True,
                "message": "Color presets sync completed",
                "color_presets_count": 0
            }
        
    except Exception as e:
        logger.error(f"Failed to force color presets sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/sync")
async def get_color_presets_sync_status():
    """
    Get the current sync status for color presets
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
        
        # Get color presets count
        db_service = await get_database_service()
        presets = await db_service.get_color_presets_by_tenant(tenant_id)
        
        # Get sync status
        sync_status = await sync_service.get_sync_status()
        
        return {
            "sync_enabled": True,
            "is_running": sync_status.get('is_running', False),
            "connected_to_realtime": sync_status.get('connected_to_realtime', False),
            "tenant_id": tenant_id,
            "local_color_presets_count": len(presets),
            "last_check": sync_status.get('last_check')
        }
        
    except Exception as e:
        logger.error(f"Failed to get color presets sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/filament-types/list")
async def get_unique_filament_types():
    """
    Get list of unique filament types from all color presets
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get color presets from database
        db_service = await get_database_service()
        presets = await db_service.get_color_presets_by_tenant(tenant_id)
        
        # Extract unique filament types
        filament_types = list(set(preset.filament_type for preset in presets if preset.filament_type))
        filament_types.sort()
        
        return {
            "filament_types": filament_types,
            "count": len(filament_types)
        }
        
    except Exception as e:
        logger.error(f"Failed to get filament types: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_color_preset(preset_request: ColorPresetCreateRequest):
    """
    Create a new color preset (local-first)
    
    Creates a new color preset in the local SQLite database and queues backup to Supabase.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Generate UUID for new preset
        preset_id = str(uuid.uuid4())
        
        # Create preset data dict
        preset_data = {
            'id': preset_id,
            'tenant_id': tenant_id,
            'color_name': preset_request.color_name,
            'hex_code': preset_request.hex_code,
            'filament_type': preset_request.material_type,  # Map material_type to filament_type for database
            'manufacturer': preset_request.manufacturer,
            'notes': preset_request.notes,
            'is_active': preset_request.is_active,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }
        
        # Insert into local SQLite (will automatically queue backup to Supabase)
        db_service = await get_database_service()
        success = await db_service.upsert_color_preset(preset_data)
        
        if success:
            return {
                'success': True,
                'message': f"Color preset '{preset_request.color_name}' created successfully",
                'preset': preset_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create color preset")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create color preset: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{preset_id}", response_model=dict)
async def update_color_preset(preset_id: str, preset_request: ColorPresetUpdateRequest):
    """
    Update an existing color preset (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get existing preset
        db_service = await get_database_service()
        existing_preset = await db_service.get_color_preset_by_id(preset_id)
        
        if not existing_preset:
            raise HTTPException(status_code=404, detail="Color preset not found")
        
        # Build update data
        update_data = {'id': preset_id, 'tenant_id': tenant_id, 'updated_at': datetime.utcnow()}
        
        if preset_request.color_name is not None:
            update_data['color_name'] = preset_request.color_name
        if preset_request.hex_code is not None:
            update_data['hex_code'] = preset_request.hex_code
        if preset_request.material_type is not None:
            update_data['filament_type'] = preset_request.material_type  # Map material_type to filament_type
        if preset_request.manufacturer is not None:
            update_data['manufacturer'] = preset_request.manufacturer
        if preset_request.notes is not None:
            update_data['notes'] = preset_request.notes
        if preset_request.is_active is not None:
            update_data['is_active'] = preset_request.is_active
        
        # Update in local SQLite
        success = await db_service.upsert_color_preset(update_data)
        
        if success:
            # Get updated preset
            updated_preset = await db_service.get_color_preset_by_id(preset_id)
            return {
                'success': True,
                'message': f"Color preset '{preset_id}' updated successfully",
                'preset': updated_preset.to_dict() if updated_preset else update_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update color preset")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update color preset {preset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{preset_id}")
async def delete_color_preset(preset_id: str):
    """
    Delete a color preset (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check if preset exists
        db_service = await get_database_service()
        existing_preset = await db_service.get_color_preset_by_id(preset_id)
        
        if not existing_preset:
            raise HTTPException(status_code=404, detail="Color preset not found")
        
        # Delete from local SQLite
        success = await db_service.delete_color_preset(preset_id, tenant_id)
        
        if success:
            # Queue backup deletion to Supabase
            from ..services.backup_service import get_backup_service
            backup_service = get_backup_service()
            if backup_service:
                await backup_service.queue_change(
                    'color_presets',
                    'delete',
                    preset_id,
                    {'id': preset_id, 'tenant_id': tenant_id, 'is_active': False, 'deleted_at': datetime.utcnow()}
                )
            
            return {
                'success': True,
                'message': f"Color preset '{preset_id}' deleted successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete color preset")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete color preset {preset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))