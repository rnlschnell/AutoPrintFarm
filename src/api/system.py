from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.requests import GCodeRequest
from src.models.responses import BaseResponse, SystemResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["System Commands & Control"])

@router.post("/{printer_id}/gcode", response_model=BaseResponse)
async def send_gcode_command(printer_id: str, gcode_request: GCodeRequest):
    """Send custom G-code command"""
    try:
        await printer_manager.send_gcode(printer_id, gcode_request.command, gcode_request.wait_for_completion)
        logger.info(f"Sent G-code command to printer {printer_id}: {gcode_request.command}")
        return BaseResponse(success=True, message=f"G-code command executed on printer {printer_id}")
    except Exception as e:
        logger.error(f"Failed to send G-code: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{printer_id}/reset", response_model=BaseResponse)
async def reset_printer(printer_id: str):
    """Reset printer to default state"""
    try:
        await printer_manager.reset_printer(printer_id)
        logger.info(f"Reset printer {printer_id}")
        return BaseResponse(success=True, message=f"Printer {printer_id} reset successfully")
    except Exception as e:
        logger.error(f"Failed to reset printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/{printer_id}/system/info", response_model=SystemResponse)
async def get_system_info(printer_id: str):
    """
    Get system information
    
    Returns detailed system information including firmware version,
    hardware details, and current system status.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Get system info using printer manager wrapper
        system_data = await printer_manager.get_system_info(printer_id)
        
        logger.debug(f"Retrieved system info for printer {printer_id}")
        
        return SystemResponse(
            success=True,
            message=f"System information retrieved for printer {printer_id}",
            printer_id=printer_id,
            system_info=system_data
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get system info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/reboot", response_model=BaseResponse)
async def reboot_printer(printer_id: str):
    """
    Reboot printer
    
    Performs a soft reboot of the printer system. This will restart
    the printer's firmware and may take several minutes to complete.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Reboot printer using printer manager wrapper
        await printer_manager.reboot_printer(printer_id)
        
        logger.warning(f"Initiated reboot for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Printer {printer_id} reboot initiated successfully"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to reboot printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))




