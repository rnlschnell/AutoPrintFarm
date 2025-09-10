from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
import os
import tempfile
import shutil
import logging
import uuid
from typing import Optional
from datetime import datetime, timedelta
from src.models.responses import BaseResponse
from src.core.threemf_processor import ThreeMFProcessor
from src.utils.mesh_utils import MeshUtils
import asyncio

logger = logging.getLogger(__name__)
router = APIRouter(tags=["3MF Object Manipulation"])

# Store for temporary files (in production, use proper storage like S3 or persistent volume)
TEMP_FILE_STORE = {}
TEMP_FILE_TTL = timedelta(hours=1)  # Files expire after 1 hour

def cleanup_old_files():
    """Remove expired temporary files"""
    current_time = datetime.now()
    expired_files = []
    
    for file_id, file_info in TEMP_FILE_STORE.items():
        if current_time - file_info['created_at'] > TEMP_FILE_TTL:
            expired_files.append(file_id)
            try:
                # Clean up the processor if available
                if 'processor' in file_info:
                    try:
                        file_info['processor'].cleanup()
                    except Exception as e:
                        logger.warning(f"Error cleaning up processor for {file_id}: {e}")
                
                # Clean up the file
                if os.path.exists(file_info['path']):
                    os.remove(file_info['path'])
                logger.info(f"Cleaned up expired file: {file_id}")
            except Exception as e:
                logger.error(f"Error cleaning up file {file_id}: {e}")
    
    for file_id in expired_files:
        del TEMP_FILE_STORE[file_id]

@router.post("/3mf/multiply", response_class=FileResponse)
async def multiply_objects(
    file: UploadFile = File(..., description="3MF file containing a single object"),
    object_count: int = Form(..., ge=1, le=100, description="Number of objects to create (1-100)"),
    spacing_mm: float = Form(..., ge=0, le=50, description="Spacing between objects in mm (0-50)")
):
    """
    Multiply objects in a 3MF file and download directly
    
    Takes a 3MF file containing a single object and creates a new 3MF file
    with the specified number of objects arranged in a grid pattern on the
    build plate. All metadata and print settings are preserved.
    
    The objects are centered on a 256x256mm build plate with 10mm safety margins.
    
    Returns the processed 3MF file for direct download. 
    After clicking 'Execute', use the 'Download' button that appears in the response section.
    """
    # Validate file type
    if not file.filename.endswith('.3mf'):
        raise HTTPException(status_code=400, detail="File must be a .3mf file")
    
    processor = ThreeMFProcessor()
    temp_input_path = None
    
    try:
        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix='.3mf') as temp_file:
            temp_input_path = temp_file.name
            content = await file.read()
            temp_file.write(content)
        
        logger.info(f"Processing 3MF file: {file.filename} with {object_count} objects and {spacing_mm}mm spacing")
        
        # Process the file with timeout for large object counts
        timeout_seconds = 30 if object_count <= 10 else 60 if object_count <= 20 else 120
        logger.info(f"Processing with {timeout_seconds}s timeout for {object_count} objects")
        
        try:
            output_path = await asyncio.wait_for(
                asyncio.to_thread(
                    processor.process_3mf,
                    temp_input_path,
                    object_count,
                    spacing_mm
                ),
                timeout=timeout_seconds
            )
        except asyncio.TimeoutError:
            logger.error(f"Processing timed out after {timeout_seconds}s for {object_count} objects")
            raise HTTPException(
                status_code=408, 
                detail=f"Processing timed out after {timeout_seconds} seconds. Try reducing the number of objects or spacing."
            )
        
        # Generate output filename
        output_filename = f"multiplied_{object_count}x_{int(spacing_mm)}mm_{file.filename}"
        
        # Clean up input temp file immediately
        if temp_input_path and os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
            except:
                pass
        
        # Schedule cleanup of temporary files after a delay
        async def delayed_cleanup():
            await asyncio.sleep(60)  # Wait 1 minute for download to complete
            try:
                processor.cleanup()
                if os.path.exists(output_path):
                    os.remove(output_path)
                logger.info(f"Cleaned up temporary files for {output_filename}")
            except Exception as e:
                logger.warning(f"Error during delayed cleanup: {e}")
        
        # Start cleanup task (fire and forget)
        asyncio.create_task(delayed_cleanup())
        
        # Return FileResponse with proper headers for Swagger UI download button
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"{output_filename}\"",
                "Content-Type": "application/octet-stream"
            }
        )
        
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing 3MF file: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
    finally:
        # Clean up input temp file if processing failed
        if temp_input_path and os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
            except:
                pass
        # Note: output file cleanup will happen when the response is sent
        # We'll schedule cleanup in a background task but with a delay

@router.get("/3mf/download/{file_id}")
async def download_multiplied_file(file_id: str):
    """
    Download a processed 3MF file
    
    Downloads the 3MF file created by the multiply endpoint.
    This endpoint is designed to work properly with browser downloads.
    Files are automatically deleted after 1 hour.
    
    Usage: Copy the download URL from the multiply response and paste it in a new browser tab,
    or click it directly if your browser supports it.
    """
    # Clean up old files
    cleanup_old_files()
    
    if file_id not in TEMP_FILE_STORE:
        raise HTTPException(status_code=404, detail="File not found or expired. Files are automatically deleted after 1 hour.")
    
    file_info = TEMP_FILE_STORE[file_id]
    
    if not os.path.exists(file_info['path']):
        # File was deleted, remove from store
        if 'processor' in file_info:
            try:
                file_info['processor'].cleanup()
            except:
                pass
        del TEMP_FILE_STORE[file_id]
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    # Return file with headers that force download
    return FileResponse(
        path=file_info['path'],
        filename=file_info['filename'],
        media_type='application/octet-stream',
        headers={
            "Content-Disposition": f"attachment; filename=\"{file_info['filename']}\"",
            "Content-Description": "File Transfer",
            "Content-Transfer-Encoding": "binary",
            "Cache-Control": "must-revalidate",
            "Pragma": "public"
        }
    )

@router.delete("/3mf/download/{file_id}", response_model=BaseResponse)
async def delete_multiplied_file(file_id: str):
    """
    Delete a processed 3MF file
    
    Manually delete a file before it expires automatically.
    """
    if file_id not in TEMP_FILE_STORE:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = TEMP_FILE_STORE[file_id]
    
    try:
        if os.path.exists(file_info['path']):
            os.remove(file_info['path'])
        del TEMP_FILE_STORE[file_id]
        
        return BaseResponse(
            success=True,
            message="File deleted successfully"
        )
    except Exception as e:
        logger.error(f"Error deleting file {file_id}: {e}")
        raise HTTPException(status_code=500, detail="Error deleting file")

@router.get("/3mf/status", response_model=BaseResponse)
async def get_manipulation_status():
    """
    Get status of 3MF manipulation service
    
    Returns information about the service and any temporary files.
    """
    # Clean up old files first
    cleanup_old_files()
    
    active_files = []
    for file_id, file_info in TEMP_FILE_STORE.items():
        active_files.append({
            "id": file_id,
            "filename": file_info['filename'],
            "created_at": file_info['created_at'].isoformat(),
            "expires_at": (file_info['created_at'] + TEMP_FILE_TTL).isoformat()
        })
    
    return BaseResponse(
        success=True,
        message="3MF manipulation service is active",
        data={
            "active_files": len(active_files),
            "files": active_files,
            "max_object_count": 100,
            "max_spacing_mm": 50,
            "build_plate_size": "256x256mm"
        }
    )