"""
API endpoints for printers management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import logging
import uuid
from datetime import datetime, date

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import Printer
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class PrinterCreateRequest(BaseModel):
    name: str
    model: str
    manufacturer: Optional[str] = None
    ip_address: Optional[str] = None
    access_code: Optional[str] = None
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    location: Optional[str] = None
    sort_order: int = 0

class PrinterUpdateRequest(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    ip_address: Optional[str] = None
    access_code: Optional[str] = None
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    location: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    current_color: Optional[str] = None
    current_filament_type: Optional[str] = None

router = APIRouter(
    prefix="/printers-sync",
    tags=["Printers Sync"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_printers():
    """
    Get all printers for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get printers from local database
        db_service = await get_database_service()
        printers = await db_service.get_printers_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [printer.to_dict() for printer in printers]
        
    except Exception as e:
        logger.error(f"Failed to get printers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_printer(printer_request: PrinterCreateRequest):
    """
    Create a new printer (local-first)
    
    Creates a new printer in the local SQLite database and queues backup to Supabase.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Generate UUID for new printer
        printer_id = str(uuid.uuid4())
        
        # Create printer data dict
        printer_data = {
            'id': printer_id,
            'tenant_id': tenant_id,
            'name': printer_request.name,
            'model': printer_request.model,
            'manufacturer': printer_request.manufacturer,
            'ip_address': printer_request.ip_address,
            'access_code': printer_request.access_code,
            'serial_number': printer_request.serial_number,
            'firmware_version': printer_request.firmware_version,
            'location': printer_request.location,
            'sort_order': printer_request.sort_order,
            'status': 'offline',
            'connection_type': 'bambu',
            'is_active': True,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }
        
        # Insert into local SQLite (will automatically queue backup to Supabase)
        db_service = await get_database_service()
        success = await db_service.upsert_printer(printer_data)
        
        if success:
            return {
                'success': True,
                'message': f"Printer '{printer_request.name}' created successfully",
                'printer': printer_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create printer")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{printer_id}", response_model=dict)
async def update_printer(printer_id: str, printer_request: PrinterUpdateRequest):
    """
    Update an existing printer (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get existing printer
        db_service = await get_database_service()
        existing_printer = await db_service.get_printer_by_id(printer_id)
        
        if not existing_printer:
            raise HTTPException(status_code=404, detail="Printer not found")
        
        # Build update data
        update_data = {'id': printer_id, 'tenant_id': tenant_id, 'updated_at': datetime.utcnow()}
        
        if printer_request.name is not None:
            update_data['name'] = printer_request.name
        if printer_request.model is not None:
            update_data['model'] = printer_request.model
        if printer_request.manufacturer is not None:
            update_data['manufacturer'] = printer_request.manufacturer
        if printer_request.ip_address is not None:
            update_data['ip_address'] = printer_request.ip_address
        if printer_request.access_code is not None:
            update_data['access_code'] = printer_request.access_code
        if printer_request.serial_number is not None:
            update_data['serial_number'] = printer_request.serial_number
        if printer_request.firmware_version is not None:
            update_data['firmware_version'] = printer_request.firmware_version
        if printer_request.location is not None:
            update_data['location'] = printer_request.location
        if printer_request.sort_order is not None:
            update_data['sort_order'] = printer_request.sort_order
        if printer_request.status is not None:
            update_data['status'] = printer_request.status
        if printer_request.current_color is not None:
            update_data['current_color'] = printer_request.current_color
        if printer_request.current_filament_type is not None:
            update_data['current_filament_type'] = printer_request.current_filament_type
        
        # Update in local SQLite
        success = await db_service.upsert_printer(update_data)
        
        if success:
            # Get updated printer
            updated_printer = await db_service.get_printer_by_id(printer_id)
            return {
                'success': True,
                'message': f"Printer '{printer_id}' updated successfully",
                'printer': updated_printer.to_dict() if updated_printer else update_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update printer")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{printer_id}")
async def delete_printer(printer_id: str):
    """
    Delete a printer (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check if printer exists
        db_service = await get_database_service()
        existing_printer = await db_service.get_printer_by_id(printer_id)
        
        if not existing_printer:
            raise HTTPException(status_code=404, detail="Printer not found")
        
        # Delete from local SQLite
        success = await db_service.delete_printer(printer_id, tenant_id)
        
        if success:
            # Queue backup deletion to Supabase
            from ..services.backup_service import get_backup_service
            backup_service = get_backup_service()
            if backup_service:
                await backup_service.queue_change(
                    'printers',
                    'delete',
                    printer_id,
                    {'id': printer_id, 'tenant_id': tenant_id, 'is_active': False, 'deleted_at': datetime.utcnow()}
                )
            
            return {
                'success': True,
                'message': f"Printer '{printer_id}' deleted successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete printer")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))