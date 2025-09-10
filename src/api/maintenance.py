from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.requests import BedLevelRequest, FlowCalibrationRequest
from src.models.responses import BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Maintenance & Calibration"])

@router.post("/{printer_id}/calibrate/bed_level", response_model=BaseResponse)
async def calibrate_bed_level(printer_id: str, bed_request: BedLevelRequest):
    """Auto bed leveling calibration"""
    try:
        await printer_manager.auto_bed_level(printer_id, bed_request.save_result)
        return BaseResponse(success=True, message="Bed leveling calibration completed")
    except Exception as e:
        logger.error(f"Failed bed leveling: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/calibrate/flow", response_model=BaseResponse)
async def calibrate_flow_rate(printer_id: str, flow_request: FlowCalibrationRequest):
    """Flow rate calibration"""
    try:
        await printer_manager.calibrate_flow(printer_id, flow_request.filament_type, flow_request.nozzle_diameter)
        return BaseResponse(success=True, message="Flow rate calibration completed")
    except Exception as e:
        logger.error(f"Failed flow calibration: {e}")
        raise HTTPException(status_code=500, detail=str(e))





@router.post("/{printer_id}/calibrate/xy", response_model=BaseResponse)
async def calibrate_xy_axes(printer_id: str):
    """
    XY calibration
    
    Calibrates the XY axes for improved dimensional accuracy.
    This process measures and corrects for any skew or scaling
    issues in the X and Y movements.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Calibrate XY axes using printer manager wrapper
        await printer_manager.calibrate_xy_axes(printer_id)
        
        logger.info(f"Started XY axes calibration for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"XY axes calibration started successfully on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to calibrate XY axes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/maintenance/cut_filament", response_model=BaseResponse)
async def cut_filament(printer_id: str):
    """
    Cut filament
    
    Activates the filament cutter mechanism to cut the filament.
    Useful for filament changes or when filament is stuck.
    Available on compatible printer models.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Cut filament using printer manager wrapper
        await printer_manager.cut_filament(printer_id)
        
        logger.info(f"Cut filament for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Filament cut successfully on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to cut filament: {e}")
        raise HTTPException(status_code=500, detail=str(e))

