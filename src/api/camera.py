from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.responses import CameraResponse, BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Camera Operations"])

@router.get("/{printer_id}/camera/snapshot", response_model=CameraResponse)
async def take_snapshot(printer_id: str):
    """Take camera snapshot"""
    try:
        snapshot_data = await printer_manager.take_snapshot(printer_id)
        return CameraResponse(success=True, message="Snapshot taken", printer_id=printer_id, snapshot=snapshot_data)
    except Exception as e:
        logger.error(f"Failed to take snapshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/camera/stop", response_model=BaseResponse)
async def stop_camera(printer_id: str):
    """Stop camera connection"""
    try:
        await printer_manager.stop_camera(printer_id)
        return BaseResponse(success=True, message="Camera stopped")
    except Exception as e:
        logger.error(f"Failed to stop camera: {e}")
        raise HTTPException(status_code=500, detail=str(e))





