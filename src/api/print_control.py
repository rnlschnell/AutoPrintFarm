from fastapi import APIRouter, HTTPException, UploadFile, File
import asyncio
import logging
from src.models.requests import PrintStartRequest, FileUploadRequest
from src.models.responses import PrintControlResponse, BaseResponse, FileUploadResponse, FileInfo
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError, PrinterOperationError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Print Control"])

@router.post("/{printer_id}/print/start", response_model=PrintControlResponse)
async def start_print(printer_id: str, print_request: PrintStartRequest):
    """
    Start a print job
    
    Starts printing the specified file on the printer. Must match Bambu Lab API specification exactly.
    The file must already exist on the printer's storage.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Prepare print parameters using correct Bambu Labs MQTT protocol
        print_params = {
            "plate_number": print_request.plate_number,
            "use_ams": print_request.use_ams,
            "flow_calibration": print_request.flow_calibration,
            "bed_leveling": print_request.bed_leveling,
            "vibration_calibration": print_request.vibration_calibration,
            "layer_inspect": print_request.layer_inspect,
            "timelapse": print_request.timelapse
        }
        
        # Add optional parameters if provided
        if print_request.ams_mapping:
            print_params["ams_mapping"] = print_request.ams_mapping
        
        # Start print using printer manager wrapper with correct protocol
        await printer_manager.start_print(printer_id, print_request.file_path, **print_params)
        
        logger.info(f"Started print job on printer {printer_id}: {print_request.file_path}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print job started successfully on printer {printer_id}",
            printer_id=printer_id,
            job_info=None  # Will be populated by status endpoint
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to start print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/print/stop", response_model=PrintControlResponse)
async def stop_print(printer_id: str):
    """
    Stop the current print job
    
    Immediately stops the current print job if one is running.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Stop print job using printer manager wrapper
        await printer_manager.stop_print(printer_id)
        
        logger.info(f"Stopped print job on printer {printer_id}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print job stopped successfully on printer {printer_id}",
            printer_id=printer_id,
            job_info=None
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to stop print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/print/pause", response_model=PrintControlResponse)
async def pause_print(printer_id: str):
    """
    Pause the current print job
    
    Pauses the current print job if one is running. The job can be resumed later.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Pause print job using printer manager wrapper
        await printer_manager.pause_print(printer_id)
        
        logger.info(f"Paused print job on printer {printer_id}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print job paused successfully on printer {printer_id}",
            printer_id=printer_id,
            job_info=None
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to pause print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/print/resume", response_model=PrintControlResponse)
async def resume_print(printer_id: str):
    """
    Resume a paused print job
    
    Resumes a previously paused print job.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Resume print job using printer manager wrapper
        await printer_manager.resume_print(printer_id)
        
        logger.info(f"Resumed print job on printer {printer_id}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print job resumed successfully on printer {printer_id}",
            printer_id=printer_id,
            job_info=None
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to resume print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/print/cancel", response_model=PrintControlResponse)
async def cancel_print(printer_id: str):
    """
    Cancel the current print job
    
    Cancels the current print job and returns the printer to idle state.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Cancel print job using printer manager wrapper
        await printer_manager.cancel_print(printer_id)
        
        logger.info(f"Cancelled print job on printer {printer_id}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print job cancelled successfully on printer {printer_id}",
            printer_id=printer_id,
            job_info=None
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to cancel print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{printer_id}/print/progress", response_model=PrintControlResponse)
async def get_print_progress(printer_id: str):
    """
    Get current print progress
    
    Returns detailed information about the current print job including progress,
    remaining time, and current layer information.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Get print progress using printer manager wrapper
        progress_data = await printer_manager.get_print_status(printer_id)
        
        logger.debug(f"Retrieved print progress for printer {printer_id}")
        
        return PrintControlResponse(
            success=True,
            message=f"Print progress retrieved for printer {printer_id}",
            printer_id=printer_id,
            job_info=progress_data  # Will be processed by response model
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get print progress: {e}")
        raise HTTPException(status_code=500, detail=str(e))