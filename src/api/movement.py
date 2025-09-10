from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.responses import MovementResponse, BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Movement Control"])

@router.post("/{printer_id}/home", response_model=MovementResponse)
async def home_all_axes(printer_id: str):
    """
    Home all axes
    
    Homes all axes (X, Y, Z) to their endstop positions. This is typically
    required before any movement operations.
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Home all axes using printer manager wrapper
        await printer_manager.home_axes(printer_id)
        
        logger.info(f"Homed all axes for printer {printer_id}")
        
        return MovementResponse(
            success=True,
            message=f"All axes homed successfully on printer {printer_id}",
            printer_id=printer_id,
            position=None  # Position will be updated after homing
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to home axes: {e}")
        raise HTTPException(status_code=500, detail=str(e))




