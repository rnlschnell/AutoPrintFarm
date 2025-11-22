from fastapi import APIRouter, HTTPException
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel
from src.models.requests import BedLevelRequest, FlowCalibrationRequest, CalibrationRequest
from src.models.responses import BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError
from src.services.database_service import get_database_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Maintenance & Calibration"])

# Request models for maintenance operations
class StartMaintenanceRequest(BaseModel):
    maintenance_type: str
    notes: Optional[str] = None

class CompleteMaintenanceRequest(BaseModel):
    task_id: str

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

@router.post("/{printer_id}/calibrate", response_model=BaseResponse)
async def calibrate_printer(printer_id: str, calibration_request: CalibrationRequest):
    """
    Calibrate printer

    Runs calibration routines on the printer.
    WARNING: Ensure the printer bed is clear and has a clean build plate installed.

    Available calibrations:
    - Bed Level: Calibrates the bed level for optimal first layer adhesion
    - Vibration Compensation: Calibrates vibration compensation for better print quality
    - Motor Noise Calibration: Calibrates motor noise for quieter operation
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)

        # Build calibration description for logging
        calibrations = []
        if calibration_request.bed_level:
            calibrations.append("bed level")
        if calibration_request.vibration_compensation:
            calibrations.append("vibration compensation")
        if calibration_request.motor_noise_calibration:
            calibrations.append("motor noise")

        calibration_str = ", ".join(calibrations) if calibrations else "none"

        # Run calibration using printer manager wrapper
        await printer_manager.calibrate_printer(
            printer_id,
            bed_level=calibration_request.bed_level,
            vibration_compensation=calibration_request.vibration_compensation,
            motor_noise_calibration=calibration_request.motor_noise_calibration
        )

        logger.info(f"Started printer calibration for printer {printer_id}: {calibration_str}")

        return BaseResponse(
            success=True,
            message=f"Printer calibration started successfully: {calibration_str}"
        )

    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to calibrate printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/maintenance/start")
async def start_maintenance(printer_id: str, request: StartMaintenanceRequest):
    """
    Start maintenance on a printer

    This will:
    1. Update printer status to 'maintenance'
    2. Create a worklist task (type='maintenance', status='in_progress')
    3. Link the task to the printer
    4. Start the timer automatically
    """
    try:
        db_service = await get_database_service()

        # 1. Get the printer to verify it exists and get tenant_id
        printer = await db_service.get_printer_by_id(printer_id)
        if not printer:
            raise HTTPException(status_code=404, detail=f"Printer {printer_id} not found")

        # 2. Update printer status to 'maintenance'
        printer_update_data = {
            'id': printer_id,
            'tenant_id': printer.tenant_id,
            'status': 'maintenance',
            'in_maintenance': True,
            'maintenance_type': request.maintenance_type,
            'updated_at': datetime.utcnow()
        }

        success = await db_service.upsert_printer(printer_update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update printer status")

        # 3. Create worklist task with status='in_progress' and started_at set
        task_id = str(uuid.uuid4())
        task_data = {
            'id': task_id,
            'tenant_id': printer.tenant_id,
            'title': f"Maintenance: {printer.name}",
            'subtitle': f"Type: {request.maintenance_type}",
            'description': request.notes or f"{request.maintenance_type} maintenance on {printer.name}",
            'task_type': 'maintenance',
            'priority': 'medium',
            'status': 'in_progress',  # Start immediately
            'printer_id': printer_id,
            'started_at': datetime.now(timezone.utc),  # Timer starts now
            'task_metadata': {
                'maintenance_type': request.maintenance_type,
                'printer_name': printer.name
            }
        }

        task = await db_service.create_worklist_task(task_data)

        logger.info(f"Started maintenance on printer {printer_id}, created task {task_id}")

        return {
            "success": True,
            "message": "Maintenance started successfully",
            "printer": {
                "id": printer_id,
                "status": "maintenance"
            },
            "task": {
                "id": task_id,
                "status": "in_progress",
                "started_at": task.started_at.isoformat() if task.started_at else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start maintenance on printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/maintenance/complete")
async def complete_maintenance(printer_id: str, request: CompleteMaintenanceRequest):
    """
    Complete maintenance on a printer

    This will:
    1. Update printer status to 'idle'
    2. Update last_maintenance_date to today
    3. Complete the worklist task
    4. Calculate actual_time_minutes based on started_at
    """
    try:
        db_service = await get_database_service()

        # 1. Get the printer to verify it exists and get tenant_id
        printer = await db_service.get_printer_by_id(printer_id)
        if not printer:
            raise HTTPException(status_code=404, detail=f"Printer {printer_id} not found")

        # 2. Get the task to verify it exists and calculate time
        task = await db_service.get_worklist_task_by_id(request.task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task {request.task_id} not found")

        # Verify the task is linked to this printer
        if task.printer_id != printer_id:
            raise HTTPException(status_code=400, detail="Task is not linked to this printer")

        # 3. Calculate actual time if task was started
        actual_time_minutes = None
        if task.started_at:
            time_diff = datetime.utcnow() - task.started_at
            actual_time_minutes = int(time_diff.total_seconds() / 60)

        # 4. Update the task to completed
        task_update = {
            'status': 'completed',
            'completed_at': datetime.utcnow(),
            'actual_time_minutes': actual_time_minutes
        }

        updated_task = await db_service.update_worklist_task(request.task_id, task_update)
        if not updated_task:
            raise HTTPException(status_code=500, detail="Failed to complete task")

        # 5. Update printer status back to 'idle' and set last_maintenance_date
        from datetime import date
        printer_update_data = {
            'id': printer_id,
            'tenant_id': printer.tenant_id,
            'status': 'idle',
            'in_maintenance': False,
            'maintenance_type': None,
            'last_maintenance_date': date.today(),
            'updated_at': datetime.utcnow()
        }

        success = await db_service.upsert_printer(printer_update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update printer status")

        logger.info(f"Completed maintenance on printer {printer_id}, task {request.task_id} took {actual_time_minutes} minutes")

        return {
            "success": True,
            "message": "Maintenance completed successfully",
            "printer": {
                "id": printer_id,
                "status": "idle",
                "last_maintenance_date": date.today().isoformat()
            },
            "task": {
                "id": request.task_id,
                "status": "completed",
                "actual_time_minutes": actual_time_minutes
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to complete maintenance on printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

