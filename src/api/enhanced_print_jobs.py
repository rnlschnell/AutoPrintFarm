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
from sqlalchemy import text

from ..services.config_service import get_config_service
from ..utils.tenant_utils import get_tenant_id_or_raise
from ..services.database_service import get_database_service
from ..services.job_queue_service import job_queue_service, JobPriority
from ..core.printer_client import printer_manager
from ..utils.validators import sanitize_bambu_filename
from ..services.auth_service import get_auth_service

logger = logging.getLogger(__name__)

def normalize_printer_model(printer_model: str) -> Optional[str]:
    """
    Normalize printer model names to Bambu code IDs

    Maps human-readable printer model names to internal Bambu codes used in 3MF files.
    Handles variations in naming (spaces, casing, etc.)

    Args:
        printer_model: Human-readable printer model name (e.g., "A1 Mini", "P1S", "X1-Carbon")

    Returns:
        Bambu model code (N1, N2S, P1P, P1S, X1, X1C, X1E) or None if not recognized

    Examples:
        >>> normalize_printer_model("A1 Mini")
        'N1'
        >>> normalize_printer_model("A1")
        'N2S'
        >>> normalize_printer_model("P1S")
        'P1S'
    """
    if not printer_model:
        return None

    # Normalize input: strip whitespace, convert to lowercase for comparison
    model_clean = printer_model.strip().lower().replace('-', ' ')

    # Mapping of printer model names to Bambu codes
    # Key is lowercase normalized name, value is Bambu code
    model_map = {
        'a1 mini': 'N1',
        'a1mini': 'N1',
        'a1m': 'N1',
        'n1': 'N1',

        'a1': 'N2S',
        'n2s': 'N2S',

        'p1p': 'P1P',

        'p1s': 'P1S',

        'x1': 'X1',

        'x1 carbon': 'X1C',
        'x1carbon': 'X1C',
        'x1c': 'X1C',

        'x1 enterprise': 'X1E',
        'x1enterprise': 'X1E',
        'x1e': 'X1E',
    }

    normalized_code = model_map.get(model_clean)

    if normalized_code:
        logger.debug(f"Normalized printer model '{printer_model}' to code '{normalized_code}'")
    else:
        logger.warning(f"Unknown printer model: '{printer_model}'")

    return normalized_code

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

        # Check if printer is in maintenance mode
        is_in_maintenance = target_printer.get("in_maintenance", False)
        if is_in_maintenance:
            maintenance_type = target_printer.get("maintenance_type", "")
            logger.warning(f"Printer {printer_id} ({printer_name}) is in maintenance mode")
            error_msg = f"Printer '{printer_name}' is currently in maintenance mode and cannot accept new jobs."
            if maintenance_type:
                error_msg += f" Maintenance type: {maintenance_type}"
            return {
                "valid": False,
                "error": error_msg,
                "printer_name": printer_name,
                "maintenance_type": maintenance_type
            }

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
                        "printer_model": target_printer.get('model', 'Unknown'),
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
                            "printer_model": target_printer.get('model', 'Unknown'),
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
                    "printer_model": target_printer.get('model', 'Unknown'),
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
                    "printer_model": target_printer.get('model', 'Unknown'),
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
    product_sku_id: Optional[str] = None  # SKU id for product variants
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

        # Get printer model for file selection
        printer_model = validation_result.get('printer_model')
        logger.info(f"Printer model: {printer_model}")

        # Get file path based on job type with enhanced error handling
        logger.info("Step 3: Getting file information")
        try:
            file_info = await _get_file_info(request.job_type, request.target_id, tenant_id, printer_model)
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
        
        # Get object_count from the selected print file and fetch SKU data if product_sku_id is provided
        requires_assembly = False
        quantity_per_print = 1
        current_stock = 0
        projected_stock = 0

        # Initialize new denormalized fields
        product_id = None
        product_name = None
        sku_name = None
        filament_grams = None
        estimated_time_minutes = None
        printer_model = None

        # Get print file metadata (object_count, filament_weight, print_time)
        try:
            print_file = await db_service.get_print_file_by_id(file_info["print_file_id"])
            if print_file:
                # Get object count
                if print_file.object_count:
                    quantity_per_print = print_file.object_count
                    logger.info(f"Using object_count from print file: {quantity_per_print}")
                else:
                    quantity_per_print = 1
                    logger.info(f"Print file object_count is null or 0, defaulting to 1")

                # Get filament weight in grams (multiply by 100 for centrigram storage)
                if print_file.filament_weight_grams:
                    filament_grams = int(print_file.filament_weight_grams * 100)
                    logger.info(f"Filament needed: {print_file.filament_weight_grams}g (stored as {filament_grams} centrigrams)")

                # Get print time in minutes
                if print_file.print_time_seconds:
                    estimated_time_minutes = int(print_file.print_time_seconds / 60)
                    logger.info(f"Estimated print time: {estimated_time_minutes} minutes")
        except Exception as file_error:
            logger.warning(f"Failed to fetch print file metadata: {file_error}, using defaults")
            quantity_per_print = 1

        # Get printer model and name
        printer_name = None
        try:
            printer = await db_service.get_printer_by_id(printer_uuid)
            if printer:
                if printer.model:
                    printer_model = printer.model
                if printer.name:
                    printer_name = printer.name
                    logger.info(f"Printer name captured: '{printer_name}'")
                else:
                    logger.warning(f"Printer {printer_uuid} has no name field set")
                logger.info(f"Printer: {printer_name} - {printer_model}")
            else:
                logger.warning(f"Printer {printer_uuid} not found in database")
        except Exception as printer_error:
            logger.warning(f"Failed to fetch printer data: {printer_error}")

        if hasattr(request, 'product_sku_id') and request.product_sku_id:
            logger.info(f"Fetching SKU data for {request.product_sku_id}")
            try:
                # Get the SKU details
                sku = await db_service.get_product_sku_by_id(request.product_sku_id)
                if sku:
                    # Extract SKU name (the code like "BAGCLIP-RED-001")
                    sku_name = sku.sku
                    product_id = sku.product_id
                    logger.info(f"SKU name: {sku_name}, Product ID: {product_id}")

                    # Get product to check assembly requirement and get product name
                    product = await db_service.get_product_by_id(request.target_id)
                    if product:
                        requires_assembly = product.requires_assembly
                        product_name = product.name
                        logger.info(f"Product name: {product_name}, Requires assembly: {requires_assembly}")

                    # Get current finished goods stock for this SKU
                    finished_good = await db_service.get_finished_good_by_sku_id(request.product_sku_id)
                    if finished_good:
                        current_stock = finished_good.current_stock or 0

                    # Calculate projected stock
                    projected_stock = current_stock + quantity_per_print

                    logger.info(f"SKU data: quantity_per_print={quantity_per_print}, assembly={requires_assembly}, current_stock={current_stock}, projected_stock={projected_stock}")
            except Exception as sku_error:
                logger.warning(f"Failed to fetch SKU data: {sku_error}")

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
            "tenant_id": tenant_id,
            "product_sku_id": request.product_sku_id if hasattr(request, "product_sku_id") else None,
            "requires_assembly": requires_assembly,
            "quantity_per_print": quantity_per_print,
            # Denormalized fields for reporting
            "product_id": product_id,
            "product_name": product_name,
            "sku_name": sku_name,
            "filament_needed_grams": filament_grams,
            "estimated_print_time_minutes": estimated_time_minutes,
            "printer_numeric_id": request.printer_id,  # Numeric ID passed in request
            "printer_model": printer_model,
            "printer_name": printer_name
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
                    "auto_start": request.start_print,
                    "quantity_per_print": quantity_per_print,
                    "current_stock": current_stock,
                    "projected_stock": projected_stock
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
                    "auto_start": request.start_print,
                    "quantity_per_print": quantity_per_print,
                    "current_stock": current_stock,
                    "projected_stock": projected_stock
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create enhanced print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def _get_file_info(job_type: str, target_id: str, tenant_id: str, printer_model: Optional[str] = None) -> Dict[str, Any]:
    """
    Get file information based on job type with model-aware selection for products

    Args:
        job_type: Type of job ('print_file' or 'product')
        target_id: ID of print file or product
        tenant_id: Tenant ID
        printer_model: Printer model name (e.g., 'A1 Mini', 'P1S') for model-aware file selection

    Returns:
        Dictionary with file information including path, filename, and metadata
    """

    if job_type == "print_file":
        # Direct print file access - check for all supported extensions (tenant-agnostic)
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
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
        # Product-linked file access with model-aware selection
        db_service = await get_database_service()
        product = await db_service.get_product_by_id(target_id)

        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        # Step 1: Try model-specific file if printer_model is provided
        selected_print_file = None
        selection_method = "unknown"

        if printer_model:
            # Normalize printer model to Bambu code (e.g., "A1 Mini" -> "N1")
            model_code = normalize_printer_model(printer_model)
            logger.info(f"Looking for print file for product {target_id} with model code: {model_code}")

            if model_code:
                # Try to get model-specific file
                model_specific_file = await db_service.get_print_file_by_product_and_model(target_id, model_code)
                if model_specific_file:
                    selected_print_file = model_specific_file
                    selection_method = f"model_specific_{model_code}"
                    logger.info(f"Found model-specific file for {model_code}: {model_specific_file.id}")

        # Step 2: Fall back to default file ONLY if no printer_model was specified
        if not selected_print_file:
            if printer_model:
                # If a specific printer model was requested but not found, do NOT fall back
                # This prevents sending incompatible files to printers
                model_code = normalize_printer_model(printer_model)
                error_msg = f"No print file found for product '{product.name}' compatible with printer model '{printer_model}' (code: {model_code}). "
                error_msg += "Please upload a print file for this printer model."
                logger.error(error_msg)
                raise HTTPException(status_code=404, detail=error_msg)
            else:
                # If no printer model specified, fallback to default is OK
                logger.info(f"No model-specific file found, trying default file for product {target_id}")
                default_file = await db_service.get_default_print_file_by_product(target_id)
                if default_file:
                    selected_print_file = default_file
                    selection_method = "default_fallback"
                    logger.info(f"Found default file: {default_file.id}")

        # Step 3: Fall back to legacy products.print_file_id if no files found in print_files table
        if not selected_print_file and product.print_file_id:
            logger.info(f"No files found in print_files table, using legacy product.print_file_id: {product.print_file_id}")
            legacy_file = await db_service.get_print_file_by_id(product.print_file_id)
            if legacy_file:
                selected_print_file = legacy_file
                selection_method = "legacy_product_reference"
                logger.info(f"Using legacy file reference: {legacy_file.id}")

        # Step 4: Raise error if no file found
        if not selected_print_file:
            error_msg = f"No print file found for product '{product.name}'"
            if printer_model:
                model_code = normalize_printer_model(printer_model)
                error_msg += f" compatible with printer model '{printer_model}' (code: {model_code}). "
                error_msg += "Please upload a print file for this printer model or a default file."
            else:
                error_msg += ". Please upload a print file for this product."

            logger.error(error_msg)
            raise HTTPException(status_code=404, detail=error_msg)

        # Step 5: Locate the physical file on disk
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files")
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        file_path = None
        actual_extension = None

        for ext in supported_extensions:
            potential_path = files_dir / f"{selected_print_file.id}{ext}"
            if potential_path.exists():
                file_path = potential_path
                actual_extension = ext
                break

        if not file_path:
            # Default to .3mf if no file found (for error message)
            file_path = files_dir / f"{selected_print_file.id}.3mf"
            actual_extension = ".3mf"

        # Step 6: Determine display filename
        if product.file_name:
            # Use clean filename from products table (authoritative source)
            filename = product.file_name
        elif selected_print_file.name:
            # Use filename from print_file record
            filename = clean_filename(selected_print_file.name)
        else:
            # Generate filename from product name
            filename = f"{product.name}_{selected_print_file.id}{actual_extension}"

        logger.info(f"Selected file {selected_print_file.id} for product {target_id} using {selection_method} method")

        return {
            "print_file_id": selected_print_file.id,
            "local_path": str(file_path),
            "filename": filename,
            "exists": file_path.exists(),
            "expected_path": str(file_path),
            "source_type": "product_linked",
            "product_name": product.name,
            "product_id": target_id,
            "selection_method": selection_method,
            "printer_model_id": selected_print_file.printer_model_id
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
            # Sanitize filename ONCE before upload for Bambu Lab compatibility
            sanitized_filename = sanitize_bambu_filename(file_info["filename"])

            logger.info(f"Step 6: Starting file upload to printer")
            logger.info(f"Upload details:")
            logger.info(f"  - File path: {file_path}")
            logger.info(f"  - Original filename: {file_info['filename']}")
            logger.info(f"  - Sanitized filename: {sanitized_filename}")
            logger.info(f"  - Target printer: {request.printer_id}")

            # Upload file with sanitized filename
            upload_result = await printer_manager.upload_file(
                printer_id=request.printer_id,
                file_path=str(file_path),
                filename=sanitized_filename
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
                # Start printing with the same sanitized filename we uploaded
                logger.info(f"Step 7: Starting print on printer {request.printer_id}")
                logger.info(f"Print start requested: {request.start_print}")
                logger.info(f"Starting print with sanitized filename: {sanitized_filename}")

                start_result = await printer_manager.start_print(
                    printer_id=request.printer_id,
                    filename=sanitized_filename,
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

@router.get("/object-count")
async def get_object_count(
    product_id: str,
    printer_id: str,
    product_sku_id: Optional[str] = None,
    fastapi_request: Request = None
):
    """
    Get object count and projected stock for a product/printer combination.

    This endpoint helps the frontend display accurate stock projections before creating a print job.
    It retrieves the object count from the appropriate print file based on the selected printer model,
    and calculates the projected stock level if a SKU is provided.

    Args:
        product_id: ID of the product
        printer_id: ID of the target printer
        product_sku_id: Optional SKU ID for stock calculation

    Returns:
        object_count: Number of objects in the print file (null if no file found)
        current_stock: Current stock level (null if no SKU provided)
        projected_stock: Projected stock after print (null if no SKU or no file)
        requires_assembly: Whether product requires assembly
        print_file_id: ID of the selected print file (null if no file found)
    """
    try:
        # Get tenant ID from request
        tenant_id = get_tenant_id_or_raise(fastapi_request)
        logger.info(f"Getting object count for product {product_id}, printer {printer_id}, tenant {tenant_id}")

        # Get database service
        db_service = await get_database_service()

        # First, query database to get the numeric printer_id from the UUID
        # The frontend sends UUID (id field), but printer_manager uses numeric IDs from YAML config
        async with db_service.get_session() as session:
            result = await session.execute(
                text("SELECT printer_id FROM printers WHERE id = :printer_id"),
                {"printer_id": printer_id}
            )
            printer_record = result.fetchone()

        if not printer_record:
            raise HTTPException(status_code=404, detail=f"Printer {printer_id} not found in database")

        numeric_printer_id = printer_record[0]
        logger.info(f"Mapped printer UUID {printer_id} to numeric ID {numeric_printer_id}")

        # Get printer info to determine model using the numeric ID
        printer = None
        printers_list = printer_manager.list_printers()
        for p in printers_list:
            # Match using the numeric ID from database
            if str(p.get("id")) == str(numeric_printer_id):
                printer = p
                break

        if not printer:
            raise HTTPException(status_code=404, detail=f"Printer with numeric ID {numeric_printer_id} not found in printer config")

        printer_model = printer.get("model")
        logger.info(f"Printer model: {printer_model}")

        # Get print file info using existing logic
        try:
            file_info = await _get_file_info("product", product_id, tenant_id, printer_model)
            print_file_id = file_info.get("print_file_id")
        except HTTPException as e:
            # No print file found for this product/printer combination
            logger.warning(f"No print file found for product {product_id}, printer model {printer_model}: {e.detail}")
            return {
                "object_count": None,
                "current_stock": None,
                "projected_stock": None,
                "requires_assembly": False,
                "print_file_id": None,
                "error": e.detail
            }

        # Get object count from print file
        object_count = 1  # Default
        try:
            print_file = await db_service.get_print_file_by_id(print_file_id)
            if print_file and print_file.object_count:
                object_count = print_file.object_count
                logger.info(f"Object count from print file: {object_count}")
            else:
                logger.warning(f"Print file {print_file_id} has no object_count, defaulting to 1")
        except Exception as e:
            logger.warning(f"Failed to get print file object_count: {e}, defaulting to 1")

        # Get product to check if assembly is required
        product = await db_service.get_product_by_id(product_id)
        requires_assembly = product.requires_assembly if product else False

        # Get current stock and calculate projected stock if SKU provided
        current_stock = None
        projected_stock = None

        if product_sku_id:
            try:
                # Get finished goods record
                finished_good = await db_service.get_finished_good_by_sku_id(product_sku_id)
                if finished_good:
                    # Use assembly-adjusted stock to match what's displayed to the user
                    current_stock = (finished_good.quantity_assembled or 0) + (finished_good.quantity_needs_assembly or 0)
                    projected_stock = current_stock + object_count
                    logger.info(f"Current stock: {current_stock}, Projected stock: {projected_stock}")
                else:
                    logger.warning(f"No finished goods record found for SKU {product_sku_id}")
            except Exception as e:
                logger.warning(f"Failed to get stock info for SKU {product_sku_id}: {e}")

        return {
            "object_count": object_count,
            "current_stock": current_stock,
            "projected_stock": projected_stock,
            "requires_assembly": requires_assembly,
            "print_file_id": print_file_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get object count: {e}")
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

        # Get printer model for file selection
        printer_model = validation_result.get('printer_model')

        # Validate file availability
        try:
            file_info = await _get_file_info(request.job_type, request.target_id, tenant_id, printer_model)
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
    """Update job status in local database only (source of truth)"""
    try:
        await db_service.update_print_job(job_id, {
            "status": status,
            "progress_percentage": progress
        }, tenant_id)
        logger.debug(f"✓ Job {job_id} status updated locally: {status} ({progress}%)")
    except Exception as e:
        logger.error(f"Failed to update job {job_id} status locally: {e}")
        # Don't raise - allow processing to continue even if status update fails
        # The job will still process, just may not show correct status

async def _update_job_status_with_times(job_id: str, status: str, progress: int, time_started, time_completed, tenant_id: str, db_service):
    """Update job status with time fields in local database only (source of truth)"""
    try:
        update_data = {
            "status": status,
            "progress_percentage": progress
        }
        if time_started is not None:
            update_data["time_started"] = time_started
        if time_completed is not None:
            update_data["time_completed"] = time_completed

        await db_service.update_print_job(job_id, update_data, tenant_id)
        logger.debug(f"✓ Job {job_id} status updated locally with times: {status}")
    except Exception as e:
        logger.error(f"Failed to update job {job_id} status with times locally: {e}")
        # Don't raise - allow processing to continue even if status update fails

async def _update_job_status_with_failure(job_id: str, failure_reason: str, tenant_id: str, db_service):
    """Update job status to failed with failure reason in local database only (source of truth)"""
    try:
        await db_service.update_print_job(job_id, {
            "status": "failed",
            "progress_percentage": 0,
            "failure_reason": failure_reason,
            "time_completed": datetime.utcnow()
        }, tenant_id)
        logger.debug(f"✓ Job {job_id} marked as failed locally")
    except Exception as e:
        logger.error(f"Failed to update job {job_id} failure status locally: {e}")
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