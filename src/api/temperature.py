from fastapi import APIRouter, HTTPException
import asyncio
import logging
from src.models.requests import TemperatureRequest
from src.models.responses import TemperatureResponse, BaseResponse
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError, ValidationError
from src.utils.validators import validate_temperature

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Temperature Control"])

@router.get("/{printer_id}/temperature", response_model=TemperatureResponse)
async def get_all_temperatures(printer_id: str):
    """
    Get all temperature information
    
    Returns current and target temperatures for nozzle, bed, and chamber
    (if supported by the printer model).
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Get temperature data using printer manager wrapper
        temp_data = await printer_manager.get_temperatures(printer_id)
        
        logger.debug(f"Retrieved temperature data for printer {printer_id}")
        
        return TemperatureResponse(
            success=True,
            message=f"Temperature data retrieved for printer {printer_id}",
            printer_id=printer_id,
            temperatures=temp_data  # Will be processed by response model
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get temperature data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/temp/nozzle", response_model=BaseResponse)
async def set_nozzle_temperature(printer_id: str, temp_request: TemperatureRequest):
    """
    Set nozzle temperature
    
    Sets the target temperature for the printer's nozzle/hotend.
    Temperature is specified in Celsius.
    """
    try:
        # Validate temperature
        validate_temperature(temp_request.temperature)
        
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Set nozzle temperature using printer manager wrapper
        await printer_manager.set_nozzle_temperature(
            printer_id,
            temp_request.temperature, 
            wait=temp_request.wait
        )
        
        logger.info(f"Set nozzle temperature to {temp_request.temperature}°C for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Nozzle temperature set to {temp_request.temperature}°C on printer {printer_id}"
        )
        
    except ValidationError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set nozzle temperature: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/temp/bed", response_model=BaseResponse)
async def set_bed_temperature(printer_id: str, temp_request: TemperatureRequest):
    """
    Set bed temperature
    
    Sets the target temperature for the printer's heated bed.
    Temperature is specified in Celsius.
    """
    try:
        # Validate temperature
        validate_temperature(temp_request.temperature)
        
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Set bed temperature using printer manager wrapper
        await printer_manager.set_bed_temperature(
            printer_id,
            temp_request.temperature, 
            wait=temp_request.wait
        )
        
        logger.info(f"Set bed temperature to {temp_request.temperature}°C for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Bed temperature set to {temp_request.temperature}°C on printer {printer_id}"
        )
        
    except ValidationError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set bed temperature: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/temp/chamber", response_model=BaseResponse)
async def set_chamber_temperature(printer_id: str, temp_request: TemperatureRequest):
    """
    Set chamber temperature
    
    Sets the target temperature for the printer's heated chamber.
    Only supported on compatible printer models (X1E, etc.).
    Temperature is specified in Celsius.
    """
    try:
        # Validate temperature
        validate_temperature(temp_request.temperature)
        
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Set chamber temperature using printer manager wrapper
        await printer_manager.set_chamber_temperature(
            printer_id,
            temp_request.temperature, 
            wait=temp_request.wait
        )
        
        logger.info(f"Set chamber temperature to {temp_request.temperature}°C for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"Chamber temperature set to {temp_request.temperature}°C on printer {printer_id}"
        )
        
    except ValidationError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set chamber temperature: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/temp/off", response_model=BaseResponse)
async def turn_off_all_heaters(printer_id: str):
    """
    Turn off all heaters
    
    Sets all heater targets to 0°C, effectively turning off the nozzle,
    bed, and chamber heaters (if applicable).
    """
    try:
        # Get connected printer client
        client = printer_manager.get_client(printer_id)
        
        # Turn off all heaters using printer manager wrapper
        await printer_manager.turn_off_heaters(printer_id)
        
        logger.info(f"Turned off all heaters for printer {printer_id}")
        
        return BaseResponse(
            success=True,
            message=f"All heaters turned off on printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to turn off heaters: {e}")
        raise HTTPException(status_code=500, detail=str(e))