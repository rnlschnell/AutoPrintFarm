"""
Enhanced print job API with auto-processing capabilities
Direct file transfer to printers without slicing
SIMPLIFIED VERSION - Direct printer manager validation only
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime
import asyncio
import re

from ..services.config_service import get_config_service
from ..utils.tenant_utils import get_tenant_id_or_raise
from ..services.database_service import get_database_service
from ..services.job_queue_service import job_queue_service, JobPriority
from ..core.printer_client import printer_manager
from supabase import create_client, Client
from ..services.auth_service import get_auth_service
from ..services.sync_service import get_sync_service

logger = logging.getLogger(__name__)

def clean_filename(filename: str) -> str:
    """
    Remove timestamp and random characters from filename if present.
    Handles patterns like: 
    - 1755983326688-SFGood3MF.gcode
    - SFGood3MF_1755983326688_eo6b.gcode  
    - 12d13552-62c3-4ff0-913c-484cfa2db316.3mf (falls back to UUID.ext)
    Returns the clean filename without timestamp/UUID.
    """
    if not filename:
        return filename
    
    # Pattern 1: timestamp prefix (13 digits followed by dash)
    pattern1 = r'^\d{13}-'
    cleaned = re.sub(pattern1, '', filename)
    
    # Pattern 2: name_timestamp_randomchars.ext -> name.ext
    pattern2 = r'_\d{13}_\w+(\.\w+)$'
    match = re.search(pattern2, cleaned)
    if match:
        # Extract base name before first underscore and add extension
        base_name = cleaned.split('_')[0]
        extension = match.group(1)
        cleaned = base_name + extension
    
    return cleaned

# Supabase client initialization
async def get_supabase_client() -> Client:
    """Get Supabase client instance from sync service"""
    sync_service = await get_sync_service()
    if not sync_service:
        logger.error("Sync service not available")
        raise Exception("Sync service not available")
    
    return sync_service.supabase

router = APIRouter(
    prefix="/enhanced-print-jobs",
    tags=["Enhanced Print Jobs"],
    responses={404: {"description": "Not found"}},
)

async def validate_printer_connection(printer_id: str, user_action: bool = True) -> Dict[str, Any]:
    """
    Simplified printer connection validation using only the printer manager
    Only accepts legitimate printer IDs (4 and 7)
    
    Args:
        printer_id: ID of the printer to validate
        user_action: If True, allows bypass of rate limits for user-initiated actions
        
    Returns:
        Dict with validation result and printer info
    """
    # Remove hardcoded printer validation - validate against actual tenant printers instead
    # The printer manager will validate if the printer exists for this tenant
    
    # Get current printer status from printer manager directly
    try:
        printers_list = printer_manager.list_printers()
        logger.info(f"Printer manager has {len(printers_list)} printers")
        
        # Find the target printer
        target_printer = None
        for p in printers_list:
            logger.info(f"Checking printer: id={p.get('id')}, name={p.get('name')}, connected={p.get('connected')}")
            if str(p.get("id")) == str(printer_id):
                target_printer = p
                break
        
        if not target_printer:
            logger.warning(f"Printer with ID {printer_id} not found in printer manager")
            return {
                "valid": False,
                "error": f"Printer with ID {printer_id} not found in system",
                "printer_name": "Unknown"
            }
        
        printer_name = f"{target_printer.get('name', 'Unknown')} ({target_printer.get('model', 'Unknown')})"
        
        # Check if printer is connected and do real connection test
        is_connected = target_printer.get("connected", False)
        logger.info(f"Printer {printer_id} basic connection status: {is_connected}")
        
        # Try to get a client to verify real connection
        try:
            client = printer_manager.get_client(printer_id)
            if client:
                logger.info(f"Printer {printer_id} client available: {client}")
                # Try to get basic status to verify connection works
                try:
                    status = await printer_manager.get_printer_status(printer_id)
                    logger.info(f"Printer {printer_id} status test successful: {status}")
                    return {
                        "valid": True,
                        "printer_name": printer_name,
                        "status": "connected",
                        "connection_test": "passed"
                    }
                except Exception as status_error:
                    logger.warning(f"Printer {printer_id} status test failed: {status_error}")
                    # Client exists but status check failed - still allow if basic connection is true
                    if is_connected:
                        return {
                            "valid": True,
                            "printer_name": printer_name,
                            "status": "connected",
                            "connection_test": "warning",
                            "warning": f"Status check failed: {str(status_error)}"
                        }
            
            # No client available - check if we should try to connect
            if not is_connected:
                logger.warning(f"Printer {printer_id} ({printer_name}) is not connected")
                return {
                    "valid": False,
                    "error": f"Printer '{printer_name}' is not connected. Please check printer connection and try again.",
                    "printer_name": printer_name
                }
            else:
                # Marked as connected but no client - allow but warn
                logger.warning(f"Printer {printer_id} marked connected but no client available")
                return {
                    "valid": True,
                    "printer_name": printer_name,
                    "status": "connected",
                    "connection_test": "no_client",
                    "warning": "Marked as connected but client not available"
                }
                
        except Exception as client_error:
            logger.error(f"Error getting client for printer {printer_id}: {client_error}")
            # If there's an error getting client but printer is marked connected, still allow
            if is_connected:
                return {
                    "valid": True,
                    "printer_name": printer_name,
                    "status": "connected",
                    "connection_test": "error",
                    "warning": f"Client error: {str(client_error)}"
                }
            else:
                return {
                    "valid": False,
                    "error": f"Printer '{printer_name}' client error: {str(client_error)}",
                    "printer_name": printer_name
                }
        
    except Exception as e:
        logger.error(f"Error checking printer connection for {printer_id}: {e}")
        return {
            "valid": False,
            "error": f"Error checking printer connection: {str(e)}",
            "printer_name": "Unknown"
        }

class CreateJobRequest(BaseModel):
    """Request model for creating enhanced print jobs"""
    job_type: str  # 'print_file' or 'product'
    target_id: str  # print_file_id or product_id
    printer_id: str
    color: str
    filament_type: str
    material_type: str
    copies: int = 1
    spacing_mm: float = 5.0
    use_ams: bool = False
    start_print: bool = True
    priority: int = 0

class JobResponse(BaseModel):
    """Response model for job creation"""
    success: bool
    message: str
    job_id: Optional[str] = None
    processing_status: Optional[Dict[str, Any]] = None
    error_details: Optional[str] = None

@router.post("/create", response_model=JobResponse)
async def create_enhanced_print_job(
    request: CreateJobRequest,
    background_tasks: BackgroundTasks,
    fastapi_request: Request
):
    """
    Create an enhanced print job with automatic processing
    Supports both print file and product modes
    """
    logger.info("=== ENHANCED JOB CREATION STARTED ===")
    logger.info(f"Job request details:")
    logger.info(f"  - Job type: {request.job_type}")
    logger.info(f"  - Target ID: {request.target_id}")
    logger.info(f"  - Printer ID: {request.printer_id}")
    logger.info(f"  - Color: {request.color}")
    logger.info(f"  - Filament type: {request.filament_type}")
    logger.info(f"  - Copies: {request.copies}")
    logger.info(f"  - Start print: {request.start_print}")
    
    try:
        # Get tenant ID from authenticated request
        logger.info("Step 1: Getting tenant configuration from authenticated context")
        tenant_id = get_tenant_id_or_raise(fastapi_request)
        logger.info(f"Tenant ID resolved from auth context: {tenant_id}")
        
        # Validate printer connection using centralized function
        logger.info("Step 2: Validating printer connection")
        logger.info(f"Validating printer ID: {request.printer_id}")
        validation_result = await validate_printer_connection(request.printer_id, user_action=True)
        logger.info(f"Printer validation result: {validation_result}")
        
        if not validation_result["valid"]:
            logger.error(f"Printer validation failed: {validation_result['error']}")
            raise HTTPException(
                status_code=404,
                detail=validation_result["error"]
            )
        
        logger.info(f"✓ Printer validation passed: {validation_result['printer_name']} - {validation_result.get('status', 'connected')}")
        
        # Get file path based on job type with enhanced error handling
        logger.info("Step 3: Getting file information")
        try:
            file_info = await _get_file_info(request.job_type, request.target_id, tenant_id)
            logger.info(f"File info retrieved: {file_info}")
            
            if not file_info["exists"]:
                logger.error(f"File not found: {file_info['expected_path']}")
                logger.error(f"Job type: {request.job_type}, Target ID: {request.target_id}, Tenant: {tenant_id}")
                
                # Check if directory exists
                from pathlib import Path
                file_dir = Path(file_info['expected_path']).parent
                dir_exists = file_dir.exists()
                logger.error(f"Parent directory exists: {dir_exists} ({file_dir})")
                
                if dir_exists:
                    # List available files in directory for debugging
                    try:
                        available_files = [f.name for f in file_dir.iterdir() if f.is_file()]
                        logger.error(f"Available files in directory: {available_files[:10]}")  # Limit to first 10
                    except Exception as list_error:
                        logger.error(f"Could not list directory contents: {list_error}")
                
                raise HTTPException(
                    status_code=404,
                    detail=f"Print file not available on Pi. Expected: {file_info['expected_path']}. Directory exists: {dir_exists}"
                )
        except HTTPException:
            raise  # Re-raise HTTP exceptions
        except Exception as file_error:
            logger.error(f"Error getting file info: {file_error}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to validate file: {str(file_error)}"
            )
        
        # Create database record first
        logger.info("Step 4: Creating database record")
        db_service = await get_database_service()
        logger.info("Database service obtained")
        
        # Step 4.5: Ensure print file exists in local database
        logger.info(f"Step 4.5: Ensuring print file {file_info['print_file_id']} exists in local database")
        existing_file = await db_service.get_print_file_by_id(file_info['print_file_id'])
        if not existing_file:
            logger.info(f"Print file {file_info['print_file_id']} not found in local DB, creating it")
            # Create the print file in local database
            print_file_data = {
                'id': file_info['print_file_id'],
                'tenant_id': tenant_id,
                'name': file_info['filename'],
                'file_size_bytes': 0,  # We don't have the actual size here
                'number_of_units': 1
            }
            created_file = await db_service.create_print_file(print_file_data)
            if not created_file:
                logger.error(f"Failed to create print file {file_info['print_file_id']} in local database")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to create print file record in local database"
                )
            logger.info(f"Successfully created print file {file_info['print_file_id']} in local database")
        else:
            logger.info(f"Print file {file_info['print_file_id']} already exists in local database")
        
        # Resolve printer_id (4,7) to actual database UUID for foreign key with detailed error handling
        logger.info(f"Step 5: Resolving printer UUID for printer_id: {request.printer_id}")
        try:
            printer_uuid = await _resolve_printer_uuid(request.printer_id, db_service, tenant_id)
            logger.info(f"Printer UUID resolution result: {printer_uuid}")
            if not printer_uuid:
                logger.error(f"Printer UUID resolution failed - no printer found with printer_id {request.printer_id} for tenant {tenant_id}")
                
                # List available printers for debugging
                available_printers = await db_service.get_printers_by_tenant(tenant_id)
                printer_ids = [str(p.printer_id) for p in available_printers if p.printer_id]
                logger.error(f"Available printer IDs for tenant {tenant_id}: {printer_ids}")
                
                raise HTTPException(
                    status_code=404,
                    detail=f"Printer with ID {request.printer_id} not found in database. Available printers: {printer_ids}"
                )
        except Exception as resolve_error:
            logger.error(f"Error during printer UUID resolution: {resolve_error}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to resolve printer reference: {str(resolve_error)}"
            )
        
        # Prepare job data for database
        job_data = {
            "printer_id": printer_uuid,  # Use resolved UUID for foreign key
            "print_file_id": file_info["print_file_id"],
            "file_name": file_info["filename"],
            "status": "queued",  # Will update based on processing result
            "color": request.color,
            "filament_type": request.filament_type,
            "material_type": request.material_type,
            "number_of_units": request.copies,
            "priority": request.priority,
            "progress_percentage": 0,
            "time_submitted": datetime.utcnow(),
            "tenant_id": tenant_id
        }
        
        # Create job in local database first (source of truth)
        logger.info("Step 6: Creating job in local database (source of truth)")
        try:
            # Use the database service to create the job locally
            db_service = await get_database_service()
            new_job = await db_service.create_print_job(job_data)
            
            if not new_job:
                raise Exception("Failed to create print job in local database")
                
            job_id = new_job.id
            logger.info(f"Job created in local database with ID: {job_id}")
            
            # Note: Backup to Supabase will happen automatically via background sync
            logger.info("Job created locally, background sync will handle Supabase backup")
            
        except Exception as supabase_error:
            logger.error(f"Failed to create job in Supabase: {supabase_error}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create job in database: {str(supabase_error)}"
            )
            
        except Exception as db_error:
            logger.error(f"Database error creating print job: {db_error}")
            
            # Provide more specific error messages for common issues
            error_str = str(db_error).lower()
            if "foreign key constraint failed" in error_str:
                detail = f"Database reference error - printer or print file not found in local database. Printer ID: {request.printer_id}, File ID: {file_info['print_file_id']}"
            elif "unique constraint" in error_str or "duplicate" in error_str:
                detail = "A print job with similar details already exists"
            elif "not null constraint" in error_str:
                detail = "Required print job information is missing"
            else:
                detail = f"Database error creating print job: {str(db_error)}"
                
            raise HTTPException(
                status_code=500, 
                detail=detail
            )
        
        if not job_id:
            raise HTTPException(
                status_code=500, 
                detail="Failed to create job record - no job ID returned"
            )
        
        logger.info(f"Created print job {job_id} for {request.job_type}: {request.target_id}")
        
        # Determine job priority based on request priority
        if request.priority >= 5:
            job_priority = JobPriority.URGENT
        elif request.priority >= 3:
            job_priority = JobPriority.HIGH
        elif request.priority >= 1:
            job_priority = JobPriority.NORMAL
        else:
            job_priority = JobPriority.LOW
        
        # For .3mf files, skip queue processing and upload directly
        logger.info(f"Step 7: Determining processing method for file: {file_info['filename']}")
        if file_info["filename"].lower().endswith('.3mf'):
            logger.info(f"✓ Direct processing selected for 3MF file: {file_info['filename']}")
            
            # Start processing in background using asyncio task
            logger.info(f"Starting background task for direct processing")
            asyncio.create_task(_process_print_job_direct(job_id, file_info, request, tenant_id))
            
            logger.info(f"✓ Job {job_id} started direct processing for 3MF file")
            
            return JobResponse(
                success=True,
                message=f"Print job created and direct upload started",
                job_id=job_id,
                processing_status={
                    "stage": "uploading",
                    "file_type": request.job_type,
                    "target_id": request.target_id,
                    "printer_id": request.printer_id,
                    "copies": request.copies,
                    "auto_start": request.start_print
                }
            )
        else:
            # For other file types, use queue processing
            queue_job_id = await job_queue_service.add_job(
                job_type="file_processing",
                payload={
                    "job_id": job_id,
                    "file_info": file_info,
                    "request": request.dict(),
                    "tenant_id": tenant_id
                },
                callback=_process_print_job_queued,
                priority=job_priority,
                max_retries=2  # Allow 2 retries for robustness
            )
            
            logger.info(f"Job {job_id} added to queue with queue ID {queue_job_id}, priority: {job_priority.name}")
            
            return JobResponse(
                success=True,
                message=f"Print job created and processing started",
                job_id=job_id,
                processing_status={
                    "stage": "initializing",
                    "file_type": request.job_type,
                    "target_id": request.target_id,
                    "printer_id": request.printer_id,
                    "copies": request.copies,
                    "auto_start": request.start_print
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create enhanced print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def _get_file_info(job_type: str, target_id: str, tenant_id: str) -> Dict[str, Any]:
    """Get file information based on job type"""
    
    if job_type == "print_file":
        # Direct print file access - check for all supported extensions
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_path = None
        actual_extension = None
        
        for ext in supported_extensions:
            potential_path = files_dir / f"{target_id}{ext}"
            if potential_path.exists():
                file_path = potential_path
                actual_extension = ext
                break
        
        if not file_path:
            # Default to .3mf if no file found (for error message)
            file_path = files_dir / f"{target_id}.3mf"
            actual_extension = ".3mf"
        
        # Get the actual filename from database - check products first (authoritative source)
        db_service = await get_database_service()
        
        # Look for a product that uses this print file to get the clean filename
        products = await db_service.get_products_by_tenant(tenant_id)
        product_filename = None
        for product in products:
            if product.print_file_id == target_id and product.file_name:
                product_filename = product.file_name
                break
        
        if product_filename:
            # Use clean filename from products table (authoritative source)
            filename = product_filename
        else:
            # Fallback: try print_file name and clean it, or use ID-based name
            print_file = await db_service.get_print_file_by_id(target_id)
            if print_file and print_file.name:
                filename = clean_filename(print_file.name)
            else:
                filename = f"{target_id}{actual_extension}"
        
        return {
            "print_file_id": target_id,
            "local_path": str(file_path),
            "filename": filename,
            "exists": file_path.exists(),
            "expected_path": str(file_path),
            "source_type": "direct_file"
        }
        
    elif job_type == "product":
        # Product-linked file access
        db_service = await get_database_service()
        product = await db_service.get_product_by_id(target_id)
        
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        if not product.print_file_id:
            raise HTTPException(status_code=404, detail="Product has no associated print file")
        
        # Check for all supported extensions
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_path = None
        actual_extension = None
        
        for ext in supported_extensions:
            potential_path = files_dir / f"{product.print_file_id}{ext}"
            if potential_path.exists():
                file_path = potential_path
                actual_extension = ext
                break
        
        if not file_path:
            # Default to .3mf if no file found (for error message)
            file_path = files_dir / f"{product.print_file_id}.3mf"
            actual_extension = ".3mf"
        
        # Use clean filename from product (authoritative source) or fallback to print_file  
        if product.file_name:
            # Use clean filename from products table (authoritative source)
            filename = product.file_name
        else:
            # Fallback: get from print_file and clean it, or use product-based name
            print_file = await db_service.get_print_file_by_id(product.print_file_id)
            if print_file and print_file.name:
                filename = clean_filename(print_file.name)
            else:
                filename = f"{product.name}_{product.print_file_id}{actual_extension}"
        
        return {
            "print_file_id": product.print_file_id,
            "local_path": str(file_path),
            "filename": filename,
            "exists": file_path.exists(),
            "expected_path": str(file_path),
            "source_type": "product_linked",
            "product_name": product.name,
            "product_id": target_id
        }
    else:
        raise HTTPException(status_code=400, detail=f"Invalid job_type: {job_type}")

async def _process_print_job_direct(
    job_id: str,
    file_info: Dict[str, Any],
    request,
    tenant_id: str
):
    """Process print job directly without queue - for .3mf files"""
    logger.info(f"Starting direct processing for job {job_id}")
    
    # Call the main processing function directly
    await _process_print_job(job_id, file_info, request, tenant_id)

async def _process_print_job_queued(payload: Dict[str, Any]):
    """Queued job callback to process the print job directly without slicing"""
    job_id = payload["job_id"]
    file_info = payload["file_info"]
    request_data = payload["request"]
    tenant_id = payload["tenant_id"]
    
    # Reconstruct request object from dict
    class SimpleRequest:
        def __init__(self, data):
            for key, value in data.items():
                setattr(self, key, value)
    
    request = SimpleRequest(request_data)
    
    await _process_print_job(job_id, file_info, request, tenant_id)

async def _process_print_job(
    job_id: str,
    file_info: Dict[str, Any],
    request,
    tenant_id: str
):
    """Process the print job by directly sending to printer without slicing"""
    
    logger.info(f"=== JOB PROCESSING STARTED FOR {job_id} ===")
    logger.info(f"Processing details:")
    logger.info(f"  - Job ID: {job_id}")
    logger.info(f"  - File: {file_info.get('filename', 'unknown')}")
    logger.info(f"  - File path: {file_info.get('local_path', 'unknown')}")
    logger.info(f"  - Printer ID: {request.printer_id}")
    logger.info(f"  - Auto-start: {request.start_print}")
    
    db_service = await get_database_service()
    
    try:
        logger.info(f"Step 1: Updating job status to processing")
        
        # Update job status to processing (local + Supabase)
        await _update_job_status(job_id, "processing", 10, tenant_id, db_service)
        logger.info(f"✓ Job status updated to processing (10%)")
        
        # Validate file exists
        logger.info(f"Step 2: Validating file exists")
        file_path = Path(file_info["local_path"])
        logger.info(f"Checking file at: {file_path}")
        if not file_path.exists():
            logger.error(f"File does not exist: {file_path}")
            raise FileNotFoundError(f"File not found: {file_path}")
        
        file_size = file_path.stat().st_size
        logger.info(f"✓ File exists: {file_path} (size: {file_size} bytes)")
        
        # Update progress - preparing file
        logger.info(f"Step 3: Updating progress to 30%")
        await _update_job_status(job_id, "processing", 30, tenant_id, db_service)
        logger.info(f"✓ Job status updated to processing (30%)")
        
        # Get printer client
        logger.info(f"Step 4: Getting printer client for printer {request.printer_id}")
        printer_client = printer_manager.get_client(request.printer_id)
        if not printer_client:
            logger.error(f"Printer client not found for printer {request.printer_id}")
            logger.error(f"Available clients: {list(printer_manager.clients.keys())}")
            raise Exception(f"Printer {request.printer_id} not connected")
        
        logger.info(f"✓ Printer client obtained for printer {request.printer_id}")
        
        # Update progress - sending to printer
        logger.info(f"Step 5: Updating progress to 60%")
        await _update_job_status(job_id, "processing", 60, tenant_id, db_service)
        logger.info(f"✓ Job status updated to processing (60%)")
        
        # Send file to printer using Bambu Lab API
        try:
            logger.info(f"Step 6: Starting file upload to printer")
            logger.info(f"Upload details:")
            logger.info(f"  - File path: {file_path}")
            logger.info(f"  - File name: {file_info['filename']}")
            logger.info(f"  - Target printer: {request.printer_id}")
            
            # Upload file to printer using printer_manager method (not raw client)
            upload_result = await printer_manager.upload_file(
                printer_id=request.printer_id,
                file_path=str(file_path),
                filename=file_info["filename"]
            )
            
            logger.info(f"Upload result: {upload_result}")
            
            if not upload_result.get("success", False):
                logger.error(f"File upload failed: {upload_result}")
                raise Exception(f"File upload failed: {upload_result.get('message', 'Unknown error')}")
            
            logger.info(f"✓ File uploaded successfully to printer {request.printer_id}: {upload_result.get('message')}")
            
            # Update progress - file uploaded
            await _update_job_status(job_id, "processing", 80, tenant_id, db_service)
            
            result = {
                "success": True,
                "upload_result": upload_result,
                "print_job": {"started": False},
                "message": "File uploaded to printer successfully"
            }
            
            if request.start_print:
                # Start printing the uploaded file
                logger.info(f"Step 7: Starting print on printer {request.printer_id}")
                logger.info(f"Print start requested: {request.start_print}")
                
                # Get the file info from upload result to start print
                uploaded_file_info = upload_result.get("file_info", {})
                logger.info(f"Using uploaded file info: {uploaded_file_info}")
                
                filename_to_print = uploaded_file_info.get("filename", file_info["filename"])
                logger.info(f"Starting print with filename: {filename_to_print}")
                
                start_result = await printer_manager.start_print(
                    printer_id=request.printer_id,
                    filename=filename_to_print,
                    use_ams=request.use_ams,
                    # Note: color/material settings would be handled by printer if supported
                )
                
                logger.info(f"Print start result: {start_result}")
                
                if start_result.get("success", False):
                    logger.info(f"✓ Print started successfully on printer {request.printer_id}")
                    result["print_job"]["started"] = True
                    result["start_result"] = start_result
                    result["message"] = "File uploaded and print started successfully"
                else:
                    logger.warning(f"File uploaded but failed to start print: {start_result.get('message', 'Unknown error')}")
                    logger.error(f"Print start failure details: {start_result}")
                    result["start_error"] = start_result.get('message', 'Failed to start print')
                    result["message"] = "File uploaded successfully but failed to start print"
                
        except Exception as send_error:
            logger.error(f"Error sending file to printer {request.printer_id}: {send_error}")
            raise Exception(f"Failed to send file to printer: {str(send_error)}")
        
        # Update progress - complete
        await _update_job_status(job_id, "processing", 90, tenant_id, db_service)
        
        # Update job with success - determine final status based on results
        if request.start_print and result.get("print_job", {}).get("started"):
            final_status = "printing"
            time_started = datetime.utcnow()
            time_completed = None
        elif request.start_print and "start_error" in result:
            final_status = "uploaded"  # File uploaded but print failed to start
            time_started = None
            time_completed = datetime.utcnow()
        else:
            final_status = "uploaded"  # File uploaded successfully, no print requested
            time_started = None
            time_completed = datetime.utcnow()
        
        await _update_job_status_with_times(job_id, final_status, 100, time_started, time_completed, tenant_id, db_service)
        
        logger.info(f"Job {job_id} processed successfully - status: {final_status}")
        if "start_error" in result:
            logger.warning(f"Job {job_id} uploaded but print start failed: {result['start_error']}")
        logger.info(f"Processing result: {result}")
        
    except Exception as e:
        logger.error(f"Failed to process job {job_id}: {e}")
        logger.error(f"Exception details: {type(e).__name__}: {str(e)}")
        
        # Update job with failure
        try:
            await _update_job_status_with_failure(job_id, f"{type(e).__name__}: {str(e)}", tenant_id, db_service)
            logger.info(f"Job {job_id} marked as failed in database")
        except Exception as db_error:
            logger.error(f"Failed to update job {job_id} with failure status: {db_error}")

@router.get("/status/{job_id}")
async def get_job_processing_status(job_id: str, fastapi_request: Request):
    """Get current processing status of a print job"""
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(fastapi_request)
        
        # Get job from database
        db_service = await get_database_service()
        job = await db_service.get_print_job_by_id(job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Helper function to safely convert datetime to ISO format
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt  # Already a string, return as-is
            if hasattr(dt, 'isoformat'):
                return dt.isoformat()
            return str(dt)  # Fallback to string conversion
        
        return {
            "success": True,
            "job_id": job_id,
            "status": job.status,
            "progress_percentage": job.progress_percentage or 0,
            "created_at": safe_isoformat(job.time_submitted),
            "started_at": safe_isoformat(job.time_started),
            "completed_at": safe_isoformat(job.time_completed),
            "failure_reason": job.failure_reason if hasattr(job, 'failure_reason') else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job status for {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/queue/status")
async def get_queue_status():
    """Get current queue status and resource information"""
    try:
        queue_status = job_queue_service.get_queue_status()
        return {
            "success": True,
            "message": "Queue status retrieved successfully",
            "timestamp": datetime.utcnow().isoformat(),
            "queue_status": queue_status
        }
    except Exception as e:
        logger.error(f"Failed to get queue status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/queue/job/{queue_job_id}")
async def get_queue_job_status(queue_job_id: str):
    """Get status of a specific job in the queue"""
    try:
        job_status = job_queue_service.get_job_status(queue_job_id)
        if not job_status:
            raise HTTPException(status_code=404, detail="Queue job not found")
        
        return {
            "success": True,
            "queue_job_id": queue_job_id,
            "job_status": job_status
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get queue job status for {queue_job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/queue/job/{queue_job_id}")
async def cancel_queue_job(queue_job_id: str):
    """Cancel a job in the queue (if not yet processing)"""
    try:
        cancelled = await job_queue_service.cancel_job(queue_job_id)
        if not cancelled:
            raise HTTPException(
                status_code=400, 
                detail="Job could not be cancelled (not found or already processing)"
            )
        
        return {
            "success": True,
            "message": f"Queue job {queue_job_id} cancelled successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel queue job {queue_job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/validate")
async def validate_job_request(request: CreateJobRequest, fastapi_request: Request):
    """Validate a job request without creating it"""
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(fastapi_request)
        
        validation_results = {
            "valid": True,
            "errors": [],
            "warnings": []
        }
        
        # Validate printer using centralized function
        validation_result = await validate_printer_connection(request.printer_id, user_action=True)
        
        if not validation_result["valid"]:
            validation_results["valid"] = False
            validation_results["errors"].append(validation_result["error"])
        else:
            if validation_result.get("status") == "connected_on_demand":
                validation_results["warnings"].append("Printer was connected on-demand for this request")
        
        # Validate file availability
        try:
            file_info = await _get_file_info(request.job_type, request.target_id, tenant_id)
            if not file_info["exists"]:
                validation_results["valid"] = False
                validation_results["errors"].append(f"Print file not available: {file_info['expected_path']}")
        except Exception as e:
            validation_results["valid"] = False
            validation_results["errors"].append(f"File validation error: {str(e)}")
        
        # Validate parameters
        if request.copies < 1 or request.copies > 100:
            validation_results["valid"] = False
            validation_results["errors"].append("Copies must be between 1 and 100")
        
        if request.spacing_mm < 0 or request.spacing_mm > 50:
            validation_results["valid"] = False
            validation_results["errors"].append("Spacing must be between 0 and 50mm")
        
        # Warnings
        if request.copies > 20:
            validation_results["warnings"].append("Large number of copies may take significant time to process")
        
        if request.spacing_mm < 2:
            validation_results["warnings"].append("Small spacing may cause parts to merge during printing")
        
        return {
            "success": True,
            "validation": validation_results,
            "request_summary": {
                "job_type": request.job_type,
                "target_id": request.target_id,
                "printer_id": request.printer_id,
                "copies": request.copies,
                "auto_start": request.start_print
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to validate job request: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def _update_job_status(job_id: str, status: str, progress: int, tenant_id: str, db_service):
    """Update job status in Supabase first (single source of truth)"""
    try:
        # Update Supabase first
        supabase = await get_supabase_client()
        result = supabase.table('print_jobs').update({
            "status": status,
            "progress_percentage": progress
        }).eq('id', job_id).execute()
        
        logger.debug(f"✓ Job {job_id} status updated in Supabase: {status} ({progress}%)")
        
        # Local database will be updated automatically via real-time sync
        
    except Exception as e:
        logger.error(f"Failed to update job {job_id} status in Supabase: {e}")
        # Don't raise - allow processing to continue even if status update fails
        # The job will still process, just may not show correct status

async def _update_job_status_with_times(job_id: str, status: str, progress: int, time_started, time_completed, tenant_id: str, db_service):
    """Update job status with time fields in Supabase first (single source of truth)"""
    try:
        # Update Supabase first
        supabase = await get_supabase_client()
        supabase_update = {
            "status": status,
            "progress_percentage": progress
        }
        if time_started is not None:
            supabase_update["time_started"] = time_started.isoformat() if hasattr(time_started, 'isoformat') else str(time_started)
        if time_completed is not None:
            supabase_update["time_completed"] = time_completed.isoformat() if hasattr(time_completed, 'isoformat') else str(time_completed)
            
        result = supabase.table('print_jobs').update(supabase_update).eq('id', job_id).execute()
        logger.debug(f"✓ Job {job_id} status updated in Supabase with times: {status}")
        
        # Local database will be updated automatically via real-time sync
        
    except Exception as e:
        logger.error(f"Failed to update job {job_id} status with times in Supabase: {e}")
        # Don't raise - allow processing to continue even if status update fails

async def _update_job_status_with_failure(job_id: str, failure_reason: str, tenant_id: str, db_service):
    """Update job status to failed with failure reason in Supabase first (single source of truth)"""
    try:
        # Update Supabase first
        supabase = await get_supabase_client()
        result = supabase.table('print_jobs').update({
            "status": "failed",
            "progress_percentage": 0,
            "failure_reason": failure_reason,
            "time_completed": datetime.utcnow().isoformat()
        }).eq('id', job_id).execute()
        
        logger.debug(f"✓ Job {job_id} marked as failed in Supabase")
        
        # Local database will be updated automatically via real-time sync
        
    except Exception as e:
        logger.error(f"Failed to update job {job_id} failure status in Supabase: {e}")
        # Don't raise - allow processing to continue

async def _resolve_printer_uuid(printer_id: str, db_service, tenant_id: str) -> Optional[str]:
    """
    Resolve printer_id (4,7) to actual database UUID for foreign key
    
    Args:
        printer_id: The printer ID (4 or 7)
        db_service: Database service instance
        tenant_id: Tenant ID
        
    Returns:
        Database UUID string for the printer, or None if not found
    """
    try:
        # Get all printers for this tenant
        printers = await db_service.get_printers_by_tenant(tenant_id)
        
        # Find printer by printer_id field
        for printer in printers:
            if str(printer.printer_id) == str(printer_id):
                logger.info(f"Resolved printer_id {printer_id} to UUID {printer.id}")
                return printer.id
        
        logger.warning(f"No printer found with printer_id {printer_id} for tenant {tenant_id}")
        return None
        
    except Exception as e:
        logger.error(f"Failed to resolve printer UUID for printer_id {printer_id}: {e}")
        return None