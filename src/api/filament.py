from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.requests import FilamentLoadRequest, FilamentUnloadRequest, FilamentChangeRequest
from src.models.responses import FilamentResponse, BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Filament Management"])

@router.get("/{printer_id}/ams", response_model=FilamentResponse)
async def get_ams_status(printer_id: str):
    """Get AMS status and filament information"""
    try:
        ams_data = await printer_manager.get_ams_status(printer_id)
        return FilamentResponse(success=True, message="AMS status retrieved", printer_id=printer_id, ams_status=ams_data)
    except Exception as e:
        logger.error(f"Failed to get AMS status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/filament/load", response_model=BaseResponse)
async def load_filament(printer_id: str, load_request: FilamentLoadRequest):
    """Load filament into printer"""
    try:
        await printer_manager.load_filament(printer_id, load_request.ams_slot)
        return BaseResponse(success=True, message="Filament loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load filament: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/filament/unload", response_model=BaseResponse)
async def unload_filament(printer_id: str, unload_request: FilamentUnloadRequest):
    """Unload filament from printer"""
    try:
        await printer_manager.unload_filament(printer_id, unload_request.ams_slot)
        return BaseResponse(success=True, message="Filament unloaded successfully")
    except Exception as e:
        logger.error(f"Failed to unload filament: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/filament/change", response_model=BaseResponse)
async def change_filament(printer_id: str, change_request: FilamentChangeRequest):
    """
    Change filament to a different AMS slot
    
    Changes the active filament from one AMS slot to another. This operation
    will unload the current filament and load the new one.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Change filament using printer manager wrapper
        await printer_manager.change_filament(printer_id, change_request.target_slot)
        
        logger.info(f"Changed filament to slot {change_request.target_slot} for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Filament changed to slot {change_request.target_slot} successfully on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to change filament: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/ams/reset", response_model=BaseResponse)
async def reset_ams(printer_id: str):
    """
    Reset AMS system
    
    Resets the Automatic Material System, which can help resolve
    filament detection and feeding issues.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Reset AMS using printer manager wrapper
        await printer_manager.reset_ams(printer_id)
        
        logger.info(f"Reset AMS for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"AMS reset successfully on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to reset AMS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/ams/calibrate", response_model=BaseResponse)
async def calibrate_ams(printer_id: str):
    """
    Calibrate AMS system
    
    Calibrates the Automatic Material System for improved filament detection
    and feeding accuracy. This process may take several minutes to complete.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Calibrate AMS using printer manager wrapper
        await printer_manager.calibrate_ams(printer_id)
        
        logger.info(f"Started AMS calibration for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"AMS calibration started successfully on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to calibrate AMS: {e}")
        raise HTTPException(status_code=500, detail=str(e))