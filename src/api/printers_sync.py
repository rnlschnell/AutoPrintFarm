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
from ..services.printer_connection_service import get_printer_connection_service
from ..models.database import Printer
from ..core.printer_client import printer_manager
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
    current_color_hex: Optional[str] = None
    current_filament_type: Optional[str] = None
    current_build_plate: Optional[str] = None
    filament_level: Optional[int] = None
    nozzle_size: Optional[float] = None
    in_maintenance: Optional[bool] = None
    maintenance_type: Optional[str] = None

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
    Create a new printer (LOCAL-ONLY)

    Creates a new printer in the local SQLite database. Printers are NOT backed up to Supabase.
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

        # Get database service and next printer_id (incremental integer) for this tenant
        # This is needed for WebSocket connections and frontend display
        db_service = await get_database_service()

        # Get ALL printers (including inactive) for this tenant to find the max printer_id
        # This prevents UNIQUE constraint violations when inactive printers exist
        existing_printers = await db_service.get_all_printers_by_tenant(tenant_id)
        max_printer_id = 0
        for printer in existing_printers:
            if printer.printer_id and printer.printer_id > max_printer_id:
                max_printer_id = printer.printer_id

        next_printer_id = max_printer_id + 1

        # Create printer data dict
        printer_data = {
            'id': printer_id,
            'tenant_id': tenant_id,
            'printer_id': next_printer_id,  # Add the incremental printer_id
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
            'is_connected': True,  # Show connected immediately when added
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }

        # Insert into local SQLite (LOCAL-ONLY, no Supabase backup)
        success = await db_service.upsert_printer(printer_data)

        if success:
            # Sync with printer connection service for immediate connection management
            try:
                connection_service = await get_printer_connection_service()
                if connection_service:
                    # Handle the newly added printer through connection service
                    await connection_service.handle_printer_added(printer_data)
                    logger.info(f"Printer {printer_id} (printer_id: {next_printer_id}) added to connection service")
                else:
                    logger.warning("Printer connection service not available, falling back to direct manager")
                    # Fallback to direct printer manager integration
                    printer_config = {
                        'id': str(next_printer_id),  # Use numeric printer_id for consistency
                        'name': printer_data.get('name'),
                        'ip': printer_data.get('ip_address'),  # Map ip_address -> ip
                        'access_code': printer_data.get('access_code'),
                        'serial': printer_data.get('serial_number'),  # Map serial_number -> serial
                        'model': printer_data.get('model'),
                        'enabled': True
                    }
                    printer_manager.add_printer(str(next_printer_id), printer_config)

                    # Auto-connect if credentials are available
                    if printer_request.ip_address and printer_request.access_code and printer_request.serial_number:
                        try:
                            await printer_manager.connect_printer(str(next_printer_id))
                            logger.info(f"Auto-connected to newly created printer: {printer_id} (printer_id: {next_printer_id})")
                            # Update status in database
                            printer_data['status'] = 'idle'
                            await db_service.upsert_printer(printer_data)
                        except Exception as e:
                            logger.warning(f"Failed to auto-connect to newly created printer {printer_id}: {e}")
                    else:
                        logger.info(f"Skipping auto-connection for printer {printer_id} - missing required connection details")
            except Exception as e:
                logger.error(f"Error syncing printer {printer_id} with connection service: {e}")
                # Don't fail the creation if connection service sync fails

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
        if printer_request.current_color_hex is not None:
            update_data['current_color_hex'] = printer_request.current_color_hex
            logger.info(f"DEBUG: Setting current_color_hex to: {printer_request.current_color_hex}")
        else:
            logger.info(f"DEBUG: current_color_hex is None in request")
        if printer_request.current_filament_type is not None:
            update_data['current_filament_type'] = printer_request.current_filament_type
        if printer_request.current_build_plate is not None:
            update_data['current_build_plate'] = printer_request.current_build_plate
        if printer_request.filament_level is not None:
            update_data['filament_level'] = printer_request.filament_level
        if printer_request.nozzle_size is not None:
            update_data['nozzle_size'] = printer_request.nozzle_size
        if printer_request.in_maintenance is not None:
            update_data['in_maintenance'] = printer_request.in_maintenance
        if printer_request.maintenance_type is not None:
            update_data['maintenance_type'] = printer_request.maintenance_type

        logger.info(f"DEBUG: Full update_data: {update_data}")
        
        # Update in local SQLite
        success = await db_service.upsert_printer(update_data)

        if success:
            # Sync with printer connection service for configuration changes
            try:
                connection_service = await get_printer_connection_service()
                if connection_service:
                    # Handle the updated printer through connection service
                    # Get the full updated printer data first
                    updated_printer = await db_service.get_printer_by_id(printer_id)
                    if updated_printer:
                        await connection_service.handle_printer_updated(updated_printer.to_dict())
                        logger.info(f"Printer {printer_id} updated in connection service")
                    else:
                        logger.warning(f"Could not retrieve updated printer {printer_id} for connection service sync")
                else:
                    logger.warning("Printer connection service not available during update")
            except Exception as e:
                logger.error(f"Error syncing updated printer {printer_id} with connection service: {e}")
                # Don't fail the update if connection service sync fails

            # Get updated printer for response
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

        # Store printer data for connection service cleanup before deletion
        printer_data = existing_printer.to_dict()

        # Delete from local SQLite
        success = await db_service.delete_printer(printer_id, tenant_id)

        if success:
            # Sync with printer connection service for immediate cleanup
            try:
                connection_service = await get_printer_connection_service()
                if connection_service:
                    # Handle the deleted printer through connection service
                    await connection_service.handle_printer_deleted(printer_data)
                    logger.info(f"Printer {printer_id} removed from connection service")
                else:
                    logger.warning("Printer connection service not available, attempting direct cleanup")
                    # Fallback to direct printer manager cleanup
                    printer_key = str(printer_data.get('printer_id', printer_id))
                    if printer_key in printer_manager.printer_configs:
                        printer_manager.remove_printer(printer_key)
                        logger.info(f"Printer {printer_key} removed directly from printer manager")
                    else:
                        logger.warning(f"Printer {printer_key} not found in printer manager for cleanup")
            except Exception as e:
                logger.error(f"Error cleaning up printer {printer_id} from connection service: {e}")
                # Continue with deletion even if cleanup fails

            # NOTE: Printers are LOCAL-ONLY, no Supabase backup deletion needed

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