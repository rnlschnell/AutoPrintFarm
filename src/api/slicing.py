from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
import os
import tempfile
import shutil
import logging
import uuid
import asyncio
from typing import Optional
from datetime import datetime, timedelta
from src.models.responses import BaseResponse
from src.core.orcaslicer_client import OrcaSlicerClient
from src.core.threemf_processor import ThreeMFProcessor
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["3MF Slicing Operations"])

# Store for temporary sliced files (extend TTL for larger files)
SLICED_FILE_STORE = {}
SLICED_FILE_TTL = timedelta(hours=2)  # Sliced files expire after 2 hours

def cleanup_old_sliced_files():
    """Remove expired sliced files"""
    current_time = datetime.now()
    expired_files = []
    
    for file_id, file_info in SLICED_FILE_STORE.items():
        if current_time - file_info['created_at'] > SLICED_FILE_TTL:
            expired_files.append(file_id)
            try:
                if os.path.exists(file_info['path']):
                    os.remove(file_info['path'])
                logger.info(f"Cleaned up expired sliced file: {file_id}")
            except Exception as e:
                logger.error(f"Error cleaning up sliced file {file_id}: {e}")
    
    for file_id in expired_files:
        del SLICED_FILE_STORE[file_id]

@router.post("/3mf/slice", response_class=FileResponse)
async def slice_3mf_file(
    file: UploadFile = File(..., description="3MF file to slice"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Slice a 3MF file using OrcaSlicer
    
    Takes a 3MF file and slices it using OrcaSlicer CLI to produce a ready-to-print
    .gcode.3mf file. This endpoint preserves all original settings and metadata
    from the input file.
    
    The slicing process may take 2-10 minutes depending on file complexity.
    Timeout is automatically calculated based on file size.
    
    Returns the sliced .gcode.3mf file for direct download.
    After clicking 'Execute', use the 'Download' button that appears in the response section.
    """
    # Validate file type
    if not file.filename.endswith('.3mf'):
        raise HTTPException(status_code=400, detail="File must be a .3mf file")
    
    orcaslicer = OrcaSlicerClient()
    temp_input_path = None
    
    try:
        # Save uploaded file to flatpak-accessible location
        import uuid
        work_dir = os.path.expanduser("~/orcaslicer-temp")
        os.makedirs(work_dir, exist_ok=True)
        temp_filename = f"input_{uuid.uuid4().hex[:8]}.3mf"
        temp_input_path = os.path.join(work_dir, temp_filename)
        
        content = await file.read()
        with open(temp_input_path, 'wb') as temp_file:
            temp_file.write(content)
        
        logger.info(f"Starting slicing process for: {file.filename}")
        
        # Validate the 3MF file
        orcaslicer.validate_3mf_file(temp_input_path)
        
        # Get file info for timeout calculation
        file_info = await orcaslicer.get_file_info(temp_input_path)
        timeout_seconds = file_info['recommended_timeout']
        
        logger.info(f"Slicing {file.filename} (size: {file_info['file_size_mb']}MB, timeout: {timeout_seconds}s)")
        
        # Generate output filename
        base_name = os.path.splitext(file.filename)[0]
        output_filename = f"{base_name}_sliced.gcode.3mf"
        
        # Slice the file (using default A1 profile since no printer specified)
        try:
            output_path = await orcaslicer.slice_3mf(
                input_path=temp_input_path,
                output_filename=output_filename,
                timeout=timeout_seconds,
                printer_id="A1"  # Default to A1 profile for standalone slicing
            )
        except asyncio.TimeoutError:
            logger.error(f"Slicing timed out after {timeout_seconds}s for {file.filename}")
            raise HTTPException(
                status_code=408, 
                detail=f"Slicing timed out after {timeout_seconds} seconds. File may be too complex or large."
            )
        except Exception as e:
            logger.error(f"Slicing failed for {file.filename}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Slicing failed: {str(e)}"
            )
        
        # Clean up input temp file immediately
        if temp_input_path and os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
            except:
                pass
        
        # Schedule cleanup of output file after download
        async def delayed_cleanup():
            await asyncio.sleep(300)  # Wait 5 minutes for download
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
                logger.info(f"Cleaned up sliced file: {output_filename}")
            except Exception as e:
                logger.warning(f"Error during delayed cleanup: {e}")
        
        # Start cleanup task
        background_tasks.add_task(delayed_cleanup)
        
        # Return FileResponse for direct download
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
        logger.error(f"Validation error for {file.filename}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error slicing 3MF file {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Error slicing file: {str(e)}")
    finally:
        # Clean up input temp file if processing failed
        if temp_input_path and os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
            except:
                pass

@router.post("/3mf/multiply-slice", response_class=FileResponse)
async def multiply_and_slice_3mf(
    file: UploadFile = File(..., description="3MF file containing a single object"),
    object_count: int = Form(..., ge=1, le=100, description="Number of objects to create (1-100)"),
    spacing_mm: float = Form(..., ge=0, le=50, description="Spacing between objects in mm (0-50)"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Multiply objects in a 3MF file and slice the result
    
    Takes a 3MF file containing a single object, multiplies it according to the
    specified parameters, then automatically slices the result using OrcaSlicer
    to produce a ready-to-print .gcode.3mf file.
    
    This combines the functionality of the multiply and slice endpoints into a
    single operation. Processing time depends on both multiplication complexity
    and slicing time (typically 3-15 minutes total).
    
    Returns the sliced .gcode.3mf file containing all multiplied objects for direct download.
    After clicking 'Execute', use the 'Download' button that appears in the response section.
    """
    # Validate file type
    if not file.filename.endswith('.3mf'):
        raise HTTPException(status_code=400, detail="File must be a .3mf file")
    
    processor = ThreeMFProcessor()
    orcaslicer = OrcaSlicerClient()
    temp_input_path = None
    multiplied_path = None
    
    try:
        # Save uploaded file to flatpak-accessible location
        import uuid
        work_dir = os.path.expanduser("~/orcaslicer-temp")
        os.makedirs(work_dir, exist_ok=True)
        temp_filename = f"input_{uuid.uuid4().hex[:8]}.3mf"
        temp_input_path = os.path.join(work_dir, temp_filename)
        
        content = await file.read()
        with open(temp_input_path, 'wb') as temp_file:
            temp_file.write(content)
        
        logger.info(f"Starting multiply-slice process for: {file.filename}")
        logger.info(f"Parameters: {object_count} objects, {spacing_mm}mm spacing")
        
        # Step 1: Multiply objects
        multiply_timeout = 30 if object_count <= 10 else 60 if object_count <= 20 else 120
        logger.info(f"Step 1: Multiplying objects (timeout: {multiply_timeout}s)")
        
        try:
            multiplied_path = await asyncio.wait_for(
                asyncio.to_thread(
                    processor.process_3mf,
                    temp_input_path,
                    object_count,
                    spacing_mm
                ),
                timeout=multiply_timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"Multiplication timed out after {multiply_timeout}s")
            raise HTTPException(
                status_code=408,
                detail=f"Object multiplication timed out after {multiply_timeout} seconds. Try reducing the number of objects."
            )
        
        # Step 2: Copy multiplied file to flatpak-accessible location
        multiplied_filename = f"multiplied_{uuid.uuid4().hex[:8]}.3mf"
        accessible_multiplied_path = os.path.join(work_dir, multiplied_filename)
        shutil.copy2(multiplied_path, accessible_multiplied_path)
        logger.info(f"Copied multiplied file to accessible location: {accessible_multiplied_path}")
        
        # Step 3: Slice the multiplied file
        file_info = await orcaslicer.get_file_info(accessible_multiplied_path)
        # Increase timeout for multiplied files as they're more complex
        slice_timeout = file_info['recommended_timeout'] + (object_count * 10)
        
        logger.info(f"Step 3: Slicing multiplied file (timeout: {slice_timeout}s)")
        
        # Generate output filename
        base_name = os.path.splitext(file.filename)[0]
        output_filename = f"{base_name}_multiplied_{object_count}x_{int(spacing_mm)}mm_sliced.gcode.3mf"
        
        try:
            output_path = await orcaslicer.slice_3mf(
                input_path=accessible_multiplied_path,
                output_filename=output_filename,
                timeout=slice_timeout,
                printer_id="A1"  # Default to A1 profile for standalone slicing
            )
        except asyncio.TimeoutError:
            logger.error(f"Slicing timed out after {slice_timeout}s")
            raise HTTPException(
                status_code=408,
                detail=f"Slicing timed out after {slice_timeout} seconds. File may be too complex for the current system."
            )
        except Exception as e:
            logger.error(f"Slicing failed: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Slicing failed: {str(e)}"
            )
        
        # Clean up intermediate files immediately
        cleanup_files = [temp_input_path, multiplied_path]
        for file_path in cleanup_files:
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass
        
        # Schedule cleanup of output file after download
        async def delayed_cleanup():
            await asyncio.sleep(300)  # Wait 5 minutes
            try:
                processor.cleanup()
                if os.path.exists(output_path):
                    os.remove(output_path)
                logger.info(f"Cleaned up multiply-slice files for: {output_filename}")
            except Exception as e:
                logger.warning(f"Error during delayed cleanup: {e}")
        
        background_tasks.add_task(delayed_cleanup)
        
        # Return FileResponse for direct download
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
        logger.error(f"Error in multiply-slice process: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
    finally:
        # Clean up temporary files if processing failed
        cleanup_files = [temp_input_path, multiplied_path]
        for file_path in cleanup_files:
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass

@router.post("/printers/{printer_id}/3mf/multiply-slice-print")
async def multiply_slice_and_print(
    printer_id: str,
    file: UploadFile = File(..., description="3MF file containing a single object"),
    object_count: int = Form(..., ge=1, le=100, description="Number of objects to create (1-100)"),
    spacing_mm: float = Form(..., ge=0, le=50, description="Spacing between objects in mm (0-50)"),
    use_ams: bool = Form(default=False, description="Use AMS for filament management"),
    start_print: bool = Form(default=True, description="Automatically start print after upload"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Complete workflow: Multiply objects, slice, upload to printer, and start print
    
    This endpoint provides a complete automated workflow:
    1. Multiplies objects in the uploaded 3MF file
    2. Slices the result using OrcaSlicer
    3. Uploads the sliced file to the specified printer
    4. Optionally starts the print job immediately
    
    This is the most automated endpoint, taking you from a single object 3MF file
    to a started print job in one operation. Perfect for production workflows.
    
    Returns status information about the entire process including print job details.
    """
    # Validate file type
    if not file.filename.endswith('.3mf'):
        raise HTTPException(status_code=400, detail="File must be a .3mf file")
    
    # Validate printer exists and is connected
    if printer_id not in printer_manager.clients:
        raise HTTPException(status_code=404, detail=f"Printer {printer_id} not found or not connected")
    
    processor = ThreeMFProcessor()
    orcaslicer = OrcaSlicerClient()
    temp_input_path = None
    multiplied_path = None
    sliced_path = None
    
    try:
        # Save uploaded file to flatpak-accessible location
        import uuid
        work_dir = os.path.expanduser("~/orcaslicer-temp")
        os.makedirs(work_dir, exist_ok=True)
        temp_filename = f"input_{uuid.uuid4().hex[:8]}.3mf"
        temp_input_path = os.path.join(work_dir, temp_filename)
        
        content = await file.read()
        with open(temp_input_path, 'wb') as temp_file:
            temp_file.write(content)
        
        logger.info(f"Starting complete workflow for printer {printer_id}: {file.filename}")
        logger.info(f"Parameters: {object_count} objects, {spacing_mm}mm spacing, AMS: {use_ams}, Auto-start: {start_print}")
        
        # Step 1: Multiply objects
        multiply_timeout = 30 if object_count <= 10 else 60 if object_count <= 20 else 120
        logger.info(f"Step 1/4: Multiplying objects (timeout: {multiply_timeout}s)")
        
        try:
            multiplied_path = await asyncio.wait_for(
                asyncio.to_thread(
                    processor.process_3mf,
                    temp_input_path,
                    object_count,
                    spacing_mm
                ),
                timeout=multiply_timeout
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=408,
                detail=f"Object multiplication timed out after {multiply_timeout} seconds"
            )
        
        # Step 2: Copy multiplied file to flatpak-accessible location
        multiplied_filename = f"multiplied_{uuid.uuid4().hex[:8]}.3mf"
        accessible_multiplied_path = os.path.join(work_dir, multiplied_filename)
        shutil.copy2(multiplied_path, accessible_multiplied_path)
        logger.info(f"Copied multiplied file to accessible location: {accessible_multiplied_path}")
        
        # Step 3: Slice the multiplied file
        file_info = await orcaslicer.get_file_info(accessible_multiplied_path)
        slice_timeout = file_info['recommended_timeout'] + (object_count * 10)
        
        logger.info(f"Step 3/4: Slicing multiplied file (timeout: {slice_timeout}s)")
        
        base_name = os.path.splitext(file.filename)[0]
        sliced_filename = f"{base_name}_x{object_count}_{int(spacing_mm)}mm.gcode.3mf"
        
        try:
            sliced_path = await orcaslicer.slice_3mf(
                input_path=accessible_multiplied_path,
                output_filename=sliced_filename,
                timeout=slice_timeout,
                printer_id=printer_id  # Use the actual printer ID for profile selection
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=408,
                detail=f"Slicing timed out after {slice_timeout} seconds"
            )
        
        # Step 4: Upload to printer
        logger.info(f"Step 4/4: Uploading to printer {printer_id}")
        
        try:
            # Read the sliced file content
            with open(sliced_path, 'rb') as f:
                file_content = f.read()
            
            # Check if printer is connected first
            if printer_id not in printer_manager.clients:
                raise RuntimeError(f"Printer {printer_id} is not connected")
            
            client = printer_manager.get_client(printer_id)
            
            # Upload using the client's upload method directly
            if hasattr(client, 'upload_file'):
                from io import BytesIO
                file_obj = BytesIO(file_content)
                upload_result = await asyncio.to_thread(client.upload_file, file_obj, sliced_filename)
                logger.info(f"Successfully uploaded {sliced_filename} to printer {printer_id}: {upload_result}")
            else:
                raise RuntimeError(f"Printer {printer_id} does not support file upload")
                
        except Exception as e:
            logger.error(f"Upload failed for printer {printer_id}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload file to printer: {str(e)}"
            )
        
        # Step 5: Start print if requested
        print_job_info = None
        if start_print:
            logger.info(f"Step 5/5: Starting print job on printer {printer_id}")
            
            try:
                # Wait for file to be processed by printer (important for .gcode.3mf files)
                await asyncio.sleep(5)
                logger.info("Waited for printer to process uploaded file")
                
                # Start the print job using the client's start_print method directly
                client = printer_manager.get_client(printer_id)
                if hasattr(client, 'start_print'):
                    start_params = {
                        'filename': sliced_filename,
                        'plate_number': 1,
                        'use_ams': use_ams,
                        'flow_calibration': True
                    }
                    start_result = await asyncio.to_thread(client.start_print, **start_params)
                    logger.info(f"Start print result: {start_result}")
                else:
                    raise RuntimeError(f"Printer {printer_id} does not support print start")
                
                if start_result:
                    print_job_info = {
                        "started": True,
                        "filename": sliced_filename,
                        "use_ams": use_ams,
                        "message": "Print job started successfully"
                    }
                    logger.info(f"Print job started successfully on printer {printer_id}")
                else:
                    print_job_info = {
                        "started": False,
                        "message": "Print job failed to start",
                        "filename": sliced_filename
                    }
                    
            except Exception as e:
                logger.error(f"Failed to start print on printer {printer_id}: {e}")
                print_job_info = {
                    "started": False,
                    "error": str(e),
                    "message": "Print job failed to start",
                    "filename": sliced_filename
                }
        else:
            print_job_info = {
                "started": False,
                "message": "File uploaded successfully, print not started (start_print=False)",
                "filename": sliced_filename
            }
        
        # Clean up all temporary files
        cleanup_files = [temp_input_path, multiplied_path, sliced_path]
        for file_path in cleanup_files:
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass
        
        # Schedule processor cleanup
        background_tasks.add_task(processor.cleanup)
        
        # Return comprehensive status
        return {
            "success": True,
            "message": "Complete workflow finished successfully",
            "timestamp": datetime.now().isoformat(),
            "printer_id": printer_id,
            "processing_summary": {
                "original_file": file.filename,
                "object_count": object_count,
                "spacing_mm": spacing_mm,
                "final_filename": sliced_filename,
                "file_uploaded": True,
                "print_started": print_job_info.get("started", False)
            },
            "print_job": print_job_info
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Error in complete workflow: {e}")
        raise HTTPException(status_code=500, detail=f"Workflow failed: {str(e)}")
    finally:
        # Clean up temporary files if processing failed
        cleanup_files = [temp_input_path, multiplied_path, sliced_path]
        for file_path in cleanup_files:
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass

@router.get("/profiles")
async def list_orcaslicer_profiles():
    """
    List all available OrcaSlicer printer profiles
    
    Returns information about all available printer profiles that can be used
    for slicing operations, including supported printer models and nozzle sizes.
    """
    orcaslicer = OrcaSlicerClient()
    
    try:
        profiles = orcaslicer.list_available_profiles()
        profile_info = []
        
        for filename, path in profiles.items():
            info = orcaslicer.get_profile_info(path)
            profile_info.append({
                "filename": filename,
                "path": path,
                "printer_model": info['printer_model'],
                "nozzle_size": info['nozzle_size'],
                "description": info['description']
            })
        
        return {
            "success": True,
            "message": "Available OrcaSlicer printer profiles",
            "timestamp": datetime.now().isoformat(),
            "profiles": profile_info,
            "total_count": len(profile_info)
        }
        
    except Exception as e:
        logger.error(f"Error listing profiles: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing profiles: {str(e)}")

@router.get("/profiles/detect/{printer_id}")
async def detect_profile_for_printer(printer_id: str):
    """
    Detect the appropriate OrcaSlicer profile for a specific printer
    
    Returns the profile that would be used for slicing operations with the
    specified printer ID, including automatic nozzle size detection.
    """
    orcaslicer = OrcaSlicerClient()
    
    try:
        # Test different nozzle sizes to see what's available
        nozzle_sizes = [0.4, 0.2, 0.6, 0.8]
        available_profiles = []
        
        for nozzle_size in nozzle_sizes:
            profile_path = orcaslicer._get_profile_for_printer_nozzle(printer_id, nozzle_size)
            if profile_path:
                info = orcaslicer.get_profile_info(profile_path)
                available_profiles.append({
                    "nozzle_size": nozzle_size,
                    "profile_path": profile_path,
                    "filename": os.path.basename(profile_path),
                    "printer_model": info['printer_model'],
                    "description": info['description']
                })
        
        # Determine the extracted printer model
        printer_model = orcaslicer._extract_printer_model(printer_id)
        
        # Find the default profile (0.4mm nozzle)
        default_profile = None
        for profile in available_profiles:
            if profile['nozzle_size'] == 0.4:
                default_profile = profile
                break
        
        return {
            "success": True,
            "message": f"Profile detection for printer {printer_id}",
            "timestamp": datetime.now().isoformat(),
            "printer_id": printer_id,
            "detected_printer_model": printer_model,
            "default_profile": default_profile,
            "available_profiles": available_profiles,
            "total_available": len(available_profiles)
        }
        
    except Exception as e:
        logger.error(f"Error detecting profile for printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error detecting profile: {str(e)}")

@router.get("/status")
async def get_slicing_status():
    """
    Get status of slicing service and temporary files
    
    Returns information about the slicing service, OrcaSlicer availability,
    and any temporary sliced files currently stored.
    """
    # Clean up old files first
    cleanup_old_sliced_files()
    
    # Check OrcaSlicer availability
    orcaslicer = OrcaSlicerClient()
    orcaslicer_available = True
    orcaslicer_error = None
    
    try:
        # Quick test to see if OrcaSlicer command is available
        test_command = orcaslicer.orcaslicer_command + ["--help"]
        process = await asyncio.create_subprocess_exec(
            *test_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        
        if process.returncode != 0:
            orcaslicer_available = False
            stderr_str = stderr.decode('utf-8', errors='ignore') if stderr else ""
            orcaslicer_error = f"OrcaSlicer returned exit code {process.returncode}: {stderr_str}"
            
    except Exception as e:
        orcaslicer_available = False
        orcaslicer_error = str(e)
    
    # Get temporary file info
    active_files = []
    for file_id, file_info in SLICED_FILE_STORE.items():
        active_files.append({
            "id": file_id,
            "filename": file_info['filename'],
            "created_at": file_info['created_at'].isoformat(),
            "expires_at": (file_info['created_at'] + SLICED_FILE_TTL).isoformat()
        })
    
    return {
        "success": True,
        "message": "Slicing service status",
        "timestamp": datetime.now().isoformat(),
        "service_info": {
            "orcaslicer_available": orcaslicer_available,
            "orcaslicer_error": orcaslicer_error,
            "orcaslicer_command": " ".join(orcaslicer.orcaslicer_command),
            "default_timeout": orcaslicer.default_timeout,
            "max_objects": 100,
            "max_spacing_mm": 50
        },
        "temporary_files": {
            "active_count": len(active_files),
            "files": active_files,
            "ttl_hours": SLICED_FILE_TTL.total_seconds() / 3600
        }
    }