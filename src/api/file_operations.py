"""
API endpoints for local file operations
Handles file upload, deletion, and management on the Pi
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
import os
import logging
from pathlib import Path
from typing import Optional
import shutil

from ..services.file_association_service import get_file_association_service
from ..services.config_service import get_config_service
from ..models.responses import BaseResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/file-operations",
    tags=["File Operations"],
    responses={404: {"description": "Not found"}},
)

@router.post("/upload/{record_id}")
async def upload_file(
    record_id: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Upload a file to local Pi storage using the Supabase record ID
    This endpoint is called by frontend after creating the Supabase record
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Validate file type
        allowed_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail=f"File must be one of: {', '.join(allowed_extensions)}")
        
        # Get file association service
        file_service = await get_file_association_service()
        
        # Create tenant directory
        tenant_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        tenant_dir.mkdir(parents=True, exist_ok=True)
        
        # Save file with record ID as filename, preserving original extension
        file_path = tenant_dir / f"{record_id}{file_extension}"
        
        # Read and save file content
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"Uploaded file {file.filename} to {file_path} for record {record_id}")
        
        # Try to associate with database record if it exists (from realtime sync)
        # If not, the background association service will handle it
        background_tasks.add_task(_try_associate_file, record_id, str(file_path))
        
        return {
            "success": True,
            "message": "File uploaded successfully",
            "record_id": record_id,
            "local_path": str(file_path),
            "file_size": len(content)
        }
        
    except Exception as e:
        logger.error(f"Failed to upload file for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{record_id}")
async def delete_file(record_id: str):
    """
    Delete a file from local Pi storage
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check for file with any supported extension
        possible_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_deleted = False
        deleted_files = []
        
        for ext in possible_extensions:
            file_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id / f"{record_id}{ext}"
            if file_path.exists():
                file_size = file_path.stat().st_size
                file_path.unlink()
                logger.info(f"Deleted file {file_path} for record {record_id} (size: {file_size} bytes)")
                deleted_files.append(str(file_path))
                file_deleted = True
                # Don't break - delete all files with this ID (in case of duplicates)
        
        if file_deleted:
            return {
                "success": True, 
                "message": f"File(s) deleted successfully", 
                "deleted_files": deleted_files
            }
        else:
            logger.warning(f"File not found for deletion with record_id: {record_id}")
            return {
                "success": True, 
                "message": "File not found (may already be deleted)",
                "deleted_files": []
            }
        
    except Exception as e:
        logger.error(f"Failed to delete file for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{record_id}")
async def replace_file(
    record_id: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Replace an existing file on local Pi storage
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Validate file type
        allowed_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail=f"File must be one of: {', '.join(allowed_extensions)}")
        
        # Delete old file if it exists with any extension
        possible_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        for ext in possible_extensions:
            old_file_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id / f"{record_id}{ext}"
            if old_file_path.exists():
                old_file_path.unlink()
                logger.info(f"Deleted old file: {old_file_path}")
        
        # Construct new file path with original extension
        file_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id / f"{record_id}{file_extension}"
        
        # Create tenant directory if it doesn't exist
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Read and save file content (will overwrite existing file)
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"Replaced file {file_path} for record {record_id}")
        
        # Try to associate with database record
        background_tasks.add_task(_try_associate_file, record_id, str(file_path))
        
        return {
            "success": True,
            "message": "File replaced successfully",
            "record_id": record_id,
            "local_path": str(file_path),
            "file_size": len(content)
        }
        
    except Exception as e:
        logger.error(f"Failed to replace file for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{record_id}/download")
async def download_file(record_id: str):
    """
    Download a file from local Pi storage
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check for file with any supported extension
        possible_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_path = None
        for ext in possible_extensions:
            potential_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id / f"{record_id}{ext}"
            if potential_path.exists():
                file_path = potential_path
                break
        
        if not file_path:
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            path=str(file_path),
            filename=os.path.basename(str(file_path)),
            media_type="application/octet-stream"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download file for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/storage/status")
async def get_storage_status():
    """
    Get storage status and file counts
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check storage directory
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        unmatched_dir = Path("/home/pi/PrintFarmSoftware/files/unmatched")
        
        file_count = 0
        total_size = 0
        unmatched_count = 0
        
        if storage_dir.exists():
            # Count all supported file types
            for ext in ['.3mf', '.stl', '.gcode', '.obj', '.amf']:
                for file_path in storage_dir.glob(f"*{ext}"):
                    file_count += 1
                    total_size += file_path.stat().st_size
        
        if unmatched_dir.exists():
            # Count all supported file types in unmatched
            unmatched_count = 0
            for ext in ['.3mf', '.stl', '.gcode', '.obj', '.amf']:
                unmatched_count += len(list(unmatched_dir.glob(f"*{ext}")))
        
        # Get disk usage
        disk_usage = shutil.disk_usage(storage_dir.parent)
        
        return {
            "tenant_id": tenant_id,
            "file_count": file_count,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "unmatched_files": unmatched_count,
            "disk_free_gb": round(disk_usage.free / (1024 * 1024 * 1024), 2),
            "disk_total_gb": round(disk_usage.total / (1024 * 1024 * 1024), 2),
            "storage_path": str(storage_dir)
        }
        
    except Exception as e:
        logger.error(f"Failed to get storage status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/maintenance/cleanup")
async def cleanup_orphaned_files():
    """
    Clean up orphaned files that haven't been matched
    """
    try:
        file_service = await get_file_association_service()
        cleaned_count = await file_service.cleanup_orphaned_files()
        
        return {
            "success": True,
            "message": f"Cleaned up {cleaned_count} orphaned files",
            "files_cleaned": cleaned_count
        }
        
    except Exception as e:
        logger.error(f"Failed to cleanup orphaned files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def _try_associate_file(record_id: str, file_path: str):
    """
    Background task to try associating a file with its database record
    """
    try:
        from ..services.database_service import get_database_service
        
        db_service = await get_database_service()
        
        # Try to find the record and update it with the file path
        async with db_service.get_session() as session:
            from sqlalchemy import text
            result = await session.execute(
                text("UPDATE print_files SET local_file_path = :file_path WHERE id = :record_id"),
                {"file_path": file_path, "record_id": record_id}
            )
            await session.commit()
            
            if result.rowcount > 0:
                logger.info(f"Associated file {file_path} with record {record_id}")
            else:
                logger.debug(f"Record {record_id} not found yet, will be handled by background service")
                
    except Exception as e:
        logger.warning(f"Could not immediately associate file {file_path} with record {record_id}: {e}")