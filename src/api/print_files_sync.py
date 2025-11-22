"""
API endpoints for print files management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import logging

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
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

@router.put("/{file_id}", response_model=dict)
async def update_print_file(file_id: str, update_data: dict):
    """
    Update a print file in local SQLite (e.g., to link it to a product)
    """
    try:
        # Get existing print file
        db_service = await get_database_service()
        existing_file = await db_service.get_print_file_by_id(file_id)

        if not existing_file:
            raise HTTPException(status_code=404, detail="Print file not found")

        # Build update data dict with existing values
        file_data = existing_file.to_dict()

        # Update only provided fields
        for key, value in update_data.items():
            if key in ['product_id', 'name', 'file_size_bytes', 'number_of_units',
                      'printer_model_id', 'print_time_seconds', 'filament_weight_grams',
                      'filament_length_meters', 'filament_type', 'nozzle_diameter',
                      'layer_count', 'curr_bed_type', 'default_print_profile']:
                file_data[key] = value

        # Update in database using upsert
        success = await db_service.upsert_print_file(file_data)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update print file")

        # Get updated file
        updated_file = await db_service.get_print_file_by_id(file_id)

        logger.info(f"Print file {file_id} updated successfully")

        return {
            "success": True,
            "message": "Print file updated successfully",
            "print_file": updated_file.to_dict() if updated_file else file_data
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update print file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{file_id}")
async def delete_print_file(file_id: str):
    """
    Delete a print file from local SQLite and Pi storage
    Removes both the database record and the physical file from disk
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Get database service
        db_service = await get_database_service()

        # Get file info before deletion
        existing_file = await db_service.get_print_file_by_id(file_id)
        if not existing_file:
            # Return success if already deleted (idempotent)
            logger.info(f"Print file {file_id} not found (may already be deleted)")
            return {
                "success": True,
                "message": "Print file not found (may already be deleted)"
            }

        # Delete physical file from Pi storage
        from pathlib import Path
        possible_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        deleted_files = []

        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
        for ext in possible_extensions:
            file_path = storage_dir / f"{file_id}{ext}"
            if file_path.exists():
                try:
                    file_path.unlink()
                    deleted_files.append(str(file_path))
                    logger.info(f"Deleted physical file: {file_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete physical file {file_path}: {e}")

        # Delete database record
        success = await db_service.delete_print_file(file_id, tenant_id)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete print file from database")

        logger.info(f"Print file {file_id} deleted successfully (DB record + {len(deleted_files)} physical files)")

        return {
            "success": True,
            "message": "Print file deleted successfully",
            "deleted_physical_files": deleted_files
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete print file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{file_id}/object-count", response_model=dict)
async def update_object_count(file_id: str, update_data: dict):
    """
    Update the object count for a print file.
    Allows users to correct parsing errors.
    
    Body: {"object_count": <integer>}
    """
    try:
        # Validate input
        if 'object_count' not in update_data:
            raise HTTPException(status_code=400, detail="object_count is required")
        
        object_count = update_data.get('object_count')
        
        # Validate object_count is a positive integer
        if not isinstance(object_count, int) or object_count < 1:
            raise HTTPException(status_code=400, detail="object_count must be a positive integer (>= 1)")
        
        # Get existing print file
        db_service = await get_database_service()
        existing_file = await db_service.get_print_file_by_id(file_id)

        if not existing_file:
            raise HTTPException(status_code=404, detail="Print file not found")

        # Build update data with only object_count changed
        file_data = existing_file.to_dict()
        file_data['object_count'] = object_count

        # Update in database
        success = await db_service.upsert_print_file(file_data)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update object count")

        # Get updated file
        updated_file = await db_service.get_print_file_by_id(file_id)

        logger.info(f"Object count for print file {file_id} updated to {object_count}")

        return {
            "success": True,
            "message": "Object count updated successfully",
            "print_file": updated_file.to_dict() if updated_file else file_data
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update object count for print file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
