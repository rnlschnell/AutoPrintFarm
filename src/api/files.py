from fastapi import APIRouter, HTTPException, UploadFile, File
import asyncio
import logging
from src.models.responses import FileListResponse, FileUploadResponse, BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["File Operations"])

@router.get("/{printer_id}/files", response_model=FileListResponse)
async def list_files(printer_id: str):
    """List files on printer storage"""
    try:
        files_data = await printer_manager.list_files(printer_id)
        return FileListResponse(success=True, message="Files retrieved", printer_id=printer_id, files=files_data, total_count=len(files_data))
    except Exception as e:
        logger.error(f"Failed to list files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/files", response_model=FileUploadResponse)
async def upload_file(printer_id: str, file: UploadFile = File(...)):
    """Upload 3MF or G-code file to printer"""
    try:
        file_content = await file.read()
        await printer_manager.upload_file(printer_id, file.filename, file_content)
        
        # Get file extension to determine file type
        file_extension = file.filename.split('.')[-1].lower()
        file_type = {
            '3mf': '3MF',
            'gcode': 'G-code', 
            'g': 'G-code'
        }.get(file_extension, 'Unknown')
        
        file_info = {
            "name": file.filename,
            "size": len(file_content),
            "file_type": file_type
        }
        
        return FileUploadResponse(success=True, message="File uploaded successfully", printer_id=printer_id, file_info=file_info)
    except Exception as e:
        logger.error(f"Failed to upload file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{printer_id}/files/all", response_model=BaseResponse)
async def delete_all_files(printer_id: str):
    """
    Delete all files from printer SD card
    
    This endpoint will:
    1. Retrieve a list of all files on the printer's SD card
    2. Delete each file individually
    3. Return a summary of the operation
    
    WARNING: This operation cannot be undone!
    """
    try:
        # Get list of all files first
        logger.info(f"Starting delete all files operation for printer {printer_id}")
        files_data = await printer_manager.list_files(printer_id)
        
        if not files_data:
            return BaseResponse(
                success=True, 
                message="No files found on printer SD card"
            )
        
        # Filter to only include deletable files (exclude system files)
        deletable_files = [
            f for f in files_data 
            if f.get('name', '').lower().endswith(('.gcode', '.3mf', '.g'))
        ]
        
        if not deletable_files:
            return BaseResponse(
                success=True,
                message=f"No deletable files found. Total files: {len(files_data)}"
            )
        
        # Delete each file
        deleted_count = 0
        failed_count = 0
        failed_files = []
        
        for file_info in deletable_files:
            filename = file_info.get('name', '')
            if filename:
                try:
                    await printer_manager.delete_file(printer_id, filename)
                    deleted_count += 1
                    logger.info(f"Deleted file: {filename}")
                except Exception as e:
                    failed_count += 1
                    failed_files.append(filename)
                    logger.error(f"Failed to delete {filename}: {e}")
        
        # Prepare response message
        if failed_count == 0:
            message = f"Successfully deleted all {deleted_count} files from printer SD card"
        else:
            message = f"Deleted {deleted_count} files, failed to delete {failed_count} files: {', '.join(failed_files[:5])}"
            if len(failed_files) > 5:
                message += f" and {len(failed_files) - 5} more"
        
        return BaseResponse(
            success=(failed_count == 0),
            message=message
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete all files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{printer_id}/files/{name}", response_model=BaseResponse)
async def delete_file(printer_id: str, name: str):
    """Delete file from printer storage"""
    try:
        await printer_manager.delete_file(printer_id, name)
        return BaseResponse(success=True, message=f"File {name} deleted successfully")
    except Exception as e:
        logger.error(f"Failed to delete file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{printer_id}/files/{name}/info", response_model=FileUploadResponse)
async def get_file_info(printer_id: str, name: str):
    """
    Get file information
    
    Returns detailed information about a specific file including size,
    modification date, and file type.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Get file info using printer manager wrapper
        file_info = await printer_manager.get_file_info(printer_id, name)
        
        logger.debug(f"Retrieved file info for {name} on printer {printer_id}")
        
        return FileUploadResponse(
            success=True,
            message=f"File information retrieved for {name}",
            printer_id=printer_id,
            file_info=file_info
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get file info: {e}")
        raise HTTPException(status_code=500, detail=str(e))