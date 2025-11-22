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
import tempfile

from ..services.file_association_service import get_file_association_service
from ..services.config_service import get_config_service
from ..models.responses import BaseResponse
from ..utils.metadata_parser import parse_3mf_metadata

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/file-operations",
    tags=["File Operations"],
    responses={404: {"description": "Not found"}},
)

@router.post("/parse-metadata")
async def parse_file_metadata(file: UploadFile = File(...)):
    """
    Parse metadata from a 3MF file without storing it permanently.
    This endpoint is used during product file upload to extract printer model information.

    The file is temporarily saved, parsed, and then deleted immediately.
    Only supports 3MF files as they contain printer model metadata.
    """
    temp_file_path = None
    try:
        # Validate file type - only 3MF files contain metadata we can parse
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension != '.3mf':
            raise HTTPException(
                status_code=400,
                detail="Only 3MF files can be parsed for metadata. Other file types (STL, GCODE, etc.) must be manually assigned to a printer model."
            )

        # Create a temporary file to parse
        with tempfile.NamedTemporaryFile(delete=False, suffix='.3mf') as temp_file:
            # Read and save file content
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name

        # Parse metadata from the temporary file
        metadata = parse_3mf_metadata(temp_file_path)

        # Extract the printer model ID (this is the key field we need)
        printer_model_id = metadata.get('printer_model_id')

        if not printer_model_id:
            logger.warning(f"Could not extract printer_model_id from file: {file.filename}")
            raise HTTPException(
                status_code=400,
                detail="Could not determine printer model from file. The file may not contain valid printer metadata."
            )

        logger.info(f"Extracted metadata from {file.filename}: printer_model_id={printer_model_id}")

        return {
            "success": True,
            "filename": file.filename,
            "printer_model_id": printer_model_id,
            "metadata": metadata
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to parse metadata from {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse file metadata: {str(e)}")
    finally:
        # Always clean up the temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.debug(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temporary file {temp_file_path}: {cleanup_error}")

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
        
        # Create storage directory (tenant-agnostic)
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
        storage_dir.mkdir(parents=True, exist_ok=True)

        # Save file with record ID as filename, preserving original extension
        file_path = storage_dir / f"{record_id}{file_extension}"
        
        # Read and save file content
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"Uploaded file {file.filename} to {file_path} for record {record_id}")

        # Parse metadata for 3MF files
        metadata = None
        if file_extension == '.3mf':
            try:
                metadata = parse_3mf_metadata(str(file_path))
                logger.info(f"Extracted metadata from 3MF file: {record_id}")
            except Exception as parse_error:
                logger.warning(f"Failed to parse 3MF metadata for {record_id}: {parse_error}")
                # Continue with upload even if metadata parsing fails

        # Try to associate with database record if it exists (from realtime sync)
        # If not, the background association service will handle it
        background_tasks.add_task(_try_associate_file, record_id, str(file_path), metadata)

        response = {
            "success": True,
            "message": "File uploaded successfully",
            "record_id": record_id,
            "local_path": str(file_path),
            "file_size": len(content)
        }

        # Include metadata in response if parsed
        if metadata:
            response["metadata"] = metadata

        return response
        
    except Exception as e:
        logger.error(f"Failed to upload file for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-product-image/{product_id}")
async def upload_product_image(
    product_id: str,
    file: UploadFile = File(...)
):
    """
    Upload a product image to local Pi storage
    Accepts JPG, JPEG, PNG files up to 10MB
    Returns the URL path to access the image
    """
    try:
        # Validate file type
        allowed_extensions = ['.jpg', '.jpeg', '.png']
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Image must be one of: {', '.join(allowed_extensions)}"
            )

        # Validate file size (10MB limit)
        content = await file.read()
        max_size = 10 * 1024 * 1024  # 10MB in bytes
        if len(content) > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"Image size must be less than 10MB (received {len(content)} bytes)"
            )

        # Create storage directory
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/product_images")
        storage_dir.mkdir(parents=True, exist_ok=True)

        # Save file with product ID as filename, preserving extension
        file_path = storage_dir / f"{product_id}{file_extension}"

        # Delete old image if exists (in case of different extension)
        for ext in allowed_extensions:
            old_file = storage_dir / f"{product_id}{ext}"
            if old_file.exists() and old_file != file_path:
                old_file.unlink()
                logger.info(f"Deleted old product image: {old_file}")

        # Save file content
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"Uploaded product image {file.filename} to {file_path} for product {product_id}")

        # Return URL path that frontend can use
        url_path = f"/product-images/{product_id}{file_extension}"

        return {
            "success": True,
            "message": "Product image uploaded successfully",
            "product_id": product_id,
            "url_path": url_path,
            "file_size": len(content)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload product image for {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{record_id}")
async def delete_file(record_id: str):
    """
    Delete a file from local Pi storage AND database record
    Removes both the physical file and the print_files database entry
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
            file_path = Path("/home/pi/PrintFarmSoftware/files/print_files") / f"{record_id}{ext}"
            if file_path.exists():
                file_size = file_path.stat().st_size
                file_path.unlink()
                logger.info(f"Deleted file {file_path} for record {record_id} (size: {file_size} bytes)")
                deleted_files.append(str(file_path))
                file_deleted = True
                # Don't break - delete all files with this ID (in case of duplicates)

        # Delete database record (do this regardless of whether physical file was found)
        from ..services.database_service import get_database_service
        db_service = await get_database_service()
        db_deleted = await db_service.delete_print_file(record_id, tenant_id)

        if db_deleted:
            logger.info(f"Deleted database record for print file {record_id}")
        else:
            logger.warning(f"Database record not found for print file {record_id} (may already be deleted)")

        if file_deleted or db_deleted:
            return {
                "success": True,
                "message": f"File(s) and database record deleted successfully",
                "deleted_files": deleted_files,
                "database_record_deleted": db_deleted
            }
        else:
            logger.warning(f"File and database record not found for deletion with record_id: {record_id}")
            return {
                "success": True,
                "message": "File and database record not found (may already be deleted)",
                "deleted_files": [],
                "database_record_deleted": False
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
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
        for ext in possible_extensions:
            old_file_path = storage_dir / f"{record_id}{ext}"
            if old_file_path.exists():
                old_file_path.unlink()
                logger.info(f"Deleted old file: {old_file_path}")

        # Construct new file path with original extension
        file_path = storage_dir / f"{record_id}{file_extension}"

        # Create storage directory if it doesn't exist
        storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Read and save file content (will overwrite existing file)
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"Replaced file {file_path} for record {record_id}")

        # Parse metadata for 3MF files
        metadata = None
        if file_extension == '.3mf':
            try:
                metadata = parse_3mf_metadata(str(file_path))
                logger.info(f"Extracted metadata from replaced 3MF file: {record_id}")
            except Exception as parse_error:
                logger.warning(f"Failed to parse 3MF metadata for {record_id}: {parse_error}")
                # Continue with replacement even if metadata parsing fails

        # Try to associate with database record
        background_tasks.add_task(_try_associate_file, record_id, str(file_path), metadata)

        response = {
            "success": True,
            "message": "File replaced successfully",
            "record_id": record_id,
            "local_path": str(file_path),
            "file_size": len(content)
        }

        # Include metadata in response if parsed
        if metadata:
            response["metadata"] = metadata

        return response
        
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
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
        for ext in possible_extensions:
            potential_path = storage_dir / f"{record_id}{ext}"
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
        
        # Check storage directory (tenant-agnostic)
        storage_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
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

async def _try_associate_file(record_id: str, file_path: str, metadata: Optional[dict] = None):
    """
    Background task to try associating a file with its database record and updating metadata
    """
    try:
        from ..services.database_service import get_database_service

        db_service = await get_database_service()

        # Build update query with metadata if available
        async with db_service.get_session() as session:
            from sqlalchemy import text

            if metadata:
                # Update with metadata fields
                update_query = text("""
                    UPDATE print_files
                    SET local_file_path = :file_path,
                        print_time_seconds = :print_time_seconds,
                        filament_weight_grams = :filament_weight_grams,
                        filament_length_meters = :filament_length_meters,
                        filament_type = :filament_type,
                        printer_model_id = :printer_model_id,
                        nozzle_diameter = :nozzle_diameter,
                        layer_count = :layer_count,
                        curr_bed_type = :curr_bed_type,
                        default_print_profile = :default_print_profile,
                        object_count = :object_count
                    WHERE id = :record_id
                """)

                params = {
                    "file_path": file_path,
                    "record_id": record_id,
                    "print_time_seconds": metadata.get('print_time_seconds'),
                    "filament_weight_grams": metadata.get('filament_weight_grams'),
                    "filament_length_meters": metadata.get('filament_length_meters'),
                    "filament_type": metadata.get('filament_type'),
                    "printer_model_id": metadata.get('printer_model_id'),
                    "nozzle_diameter": metadata.get('nozzle_diameter'),
                    "layer_count": metadata.get('layer_count'),
                    "curr_bed_type": metadata.get('curr_bed_type'),
                    "default_print_profile": metadata.get('default_print_profile'),
                    "object_count": metadata.get('object_count') or 1,
                }
            else:
                # Update only file path
                update_query = text("UPDATE print_files SET local_file_path = :file_path WHERE id = :record_id")
                params = {"file_path": file_path, "record_id": record_id}

            result = await session.execute(update_query, params)
            await session.commit()

            if result.rowcount > 0:
                if metadata:
                    logger.info(f"Associated file {file_path} with record {record_id} and updated metadata")
                else:
                    logger.info(f"Associated file {file_path} with record {record_id}")
            else:
                logger.debug(f"Record {record_id} not found yet, will be handled by background service")

    except Exception as e:
        logger.warning(f"Could not immediately associate file {file_path} with record {record_id}: {e}")