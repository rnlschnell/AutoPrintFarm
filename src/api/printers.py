from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import asyncio
import logging
from pydantic import BaseModel
from src.models.requests import PrinterCreateRequest, PrinterUpdateRequest
from src.models.responses import (
    PrinterListResponse, PrinterCreateResponse, PrinterStatusResponse, 
    BaseResponse, ErrorResponse, PrinterInfo
)
from src.core.printer_client import printer_manager
from src.core.connection_manager import connection_manager
from src.core.config import load_printers_config, save_printers_config
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError, ValidationError
from src.utils.validators import validate_printer_config

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Printer Management"])

@router.get("", response_model=PrinterListResponse)
async def list_printers():
    """
    List all configured printers
    
    Returns a list of all configured printers with their connection status.
    """
    try:
        # Load printers from configuration
        config = load_printers_config()
        
        # Update printer manager with current config
        for printer_config in config.get("printers", []):
            printer_manager.add_printer(printer_config["id"], printer_config)
        
        # Get printer list with connection status
        printers = printer_manager.list_printers()
        
        return PrinterListResponse(
            success=True,
            message="Printers retrieved successfully",
            printers=[PrinterInfo(**printer) for printer in printers],
            total_count=len(printers)
        )
        
    except Exception as e:
        logger.error(f"Failed to list printers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("", response_model=PrinterCreateResponse)
async def create_printer(printer_request: PrinterCreateRequest):
    """
    Add a new printer configuration
    
    Creates a new printer configuration and saves it to the printers.yaml file.
    The printer can then be connected to and controlled via other endpoints.
    """
    try:
        # Validate printer configuration
        printer_dict = printer_request.dict()
        validate_printer_config(printer_dict)
        
        # Load current configuration
        config = load_printers_config()
        
        # Check if printer ID already exists
        existing_ids = [p["id"] for p in config.get("printers", [])]
        if printer_request.id in existing_ids:
            raise HTTPException(
                status_code=400, 
                detail=f"Printer with ID '{printer_request.id}' already exists"
            )
        
        # Add new printer to configuration
        if "printers" not in config:
            config["printers"] = []
        
        config["printers"].append(printer_dict)
        
        # Save updated configuration
        save_printers_config(config)
        
        # Add to printer manager
        printer_manager.add_printer(printer_request.id, printer_dict)
        
        # Auto-connect the newly created printer
        connection_successful = False
        try:
            await printer_manager.connect_printer(printer_request.id)
            connection_successful = True
            logger.info(f"Auto-connected to newly created printer: {printer_request.id}")
        except Exception as e:
            logger.warning(f"Failed to auto-connect to newly created printer {printer_request.id}: {e}")
            # Don't fail the creation if connection fails
        
        # Create response
        printer_info = PrinterInfo(**printer_dict, connected=connection_successful)
        
        return PrinterCreateResponse(
            success=True,
            message=f"Printer '{printer_request.name}' created successfully",
            printer=printer_info
        )
        
    except ValidationError as e:
        logger.error(f"Validation error creating printer: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{printer_id}/status", response_model=PrinterStatusResponse)
async def get_printer_status(printer_id: str):
    """
    Get current status of a specific printer
    
    Returns detailed status information for the specified printer including
    temperatures, position, print job status, and more.
    """
    try:
        # Get printer status from manager
        status = await printer_manager.get_printer_status(printer_id)
        
        return PrinterStatusResponse(
            success=True,
            message=f"Status retrieved for printer {printer_id}",
            printer_id=printer_id,
            status=status
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get printer status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{printer_id}/info", response_model=PrinterCreateResponse)
async def get_printer_info(printer_id: str):
    """
    Get printer information and configuration
    
    Returns the configuration details for the specified printer.
    """
    try:
        # Get printer configuration
        config = printer_manager.get_printer_config(printer_id)
        
        # Check connection status
        printers = printer_manager.list_printers()
        printer_data = next((p for p in printers if p["id"] == printer_id), None)
        
        if not printer_data:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        
        printer_info = PrinterInfo(**printer_data)
        
        return PrinterCreateResponse(
            success=True,
            message=f"Information retrieved for printer {printer_id}",
            printer=printer_info
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get printer info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/connect", response_model=BaseResponse)
async def connect_printer(printer_id: str):
    """
    Connect to a specific printer
    
    Establishes an MQTT connection to the specified printer using the
    configured IP address, access code, and serial number.
    """
    try:
        # Connect to printer
        await printer_manager.connect_printer(printer_id)
        
        return BaseResponse(
            success=True,
            message=f"Successfully connected to printer {printer_id}"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Failed to connect to printer: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error connecting to printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/disconnect", response_model=BaseResponse)
async def disconnect_printer(printer_id: str):
    """
    Disconnect from a specific printer

    Closes the MQTT connection to the specified printer.
    """
    try:
        # Disconnect from printer
        printer_manager.disconnect_printer(printer_id)

        return BaseResponse(
            success=True,
            message=f"Successfully disconnected from printer {printer_id}"
        )

    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to disconnect from printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/reconnect", response_model=BaseResponse)
async def reconnect_printer(printer_id: str):
    """
    Manually reconnect to a printer

    Resets the connection attempt counter and attempts to reconnect to the printer.
    This is useful when a printer has reached the maximum auto-reconnect attempts
    and needs to be manually reconnected.
    """
    try:
        # Reset the attempt counter to allow reconnection
        connection_manager.reset_attempt_count(printer_id)

        # Attempt to connect to the printer (user_action=True bypasses attempt limit)
        await printer_manager.connect_printer(printer_id)

        return BaseResponse(
            success=True,
            message=f"Successfully reconnected to printer {printer_id}"
        )

    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Failed to reconnect to printer: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error reconnecting to printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{printer_id}", response_model=PrinterCreateResponse)
async def update_printer(printer_id: str, printer_update: PrinterUpdateRequest):
    """
    Update printer configuration
    
    Updates the configuration for an existing printer. Only provided fields
    will be updated, others will remain unchanged.
    """
    try:
        # Load current configuration
        config = load_printers_config()
        
        # Find printer in configuration
        printer_index = None
        for i, printer in enumerate(config.get("printers", [])):
            if printer["id"] == printer_id:
                printer_index = i
                break
        
        if printer_index is None:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        
        # Update printer configuration
        current_printer = config["printers"][printer_index]
        update_data = printer_update.dict(exclude_unset=True)
        
        for key, value in update_data.items():
            current_printer[key] = value
        
        # Validate updated configuration
        validate_printer_config(current_printer)
        
        # Save updated configuration
        save_printers_config(config)
        
        # Update printer manager
        printer_manager.add_printer(printer_id, current_printer)
        
        # Create response
        printer_info = PrinterInfo(**current_printer, connected=printer_id in printer_manager.clients)
        
        return PrinterCreateResponse(
            success=True,
            message=f"Printer {printer_id} updated successfully",
            printer=printer_info
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except ValidationError as e:
        logger.error(f"Validation error updating printer: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{printer_id}", response_model=BaseResponse)
async def delete_printer(printer_id: str):
    """
    Delete a printer configuration
    
    Removes the printer configuration and disconnects if currently connected.
    """
    try:
        # Load current configuration
        config = load_printers_config()
        
        # Find and remove printer from configuration
        original_count = len(config.get("printers", []))
        config["printers"] = [p for p in config.get("printers", []) if p["id"] != printer_id]
        
        if len(config["printers"]) == original_count:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        
        # Save updated configuration
        save_printers_config(config)
        
        # Remove from printer manager
        printer_manager.remove_printer(printer_id)
        
        return BaseResponse(
            success=True,
            message=f"Printer {printer_id} deleted successfully"
        )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete printer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/light/toggle", response_model=BaseResponse)
async def toggle_printer_light(printer_id: str):
    """
    Toggle printer chamber light on/off
    
    Toggles the chamber light on the specified printer. This endpoint will 
    get the current light state and toggle to the opposite state.
    """
    try:
        # Convert printer_id to string format expected by printer manager
        result = await printer_manager.toggle_light(printer_id)
        
        if result.get("success"):
            return BaseResponse(
                success=True,
                message=result.get("message", f"Light toggled for printer {printer_id}")
            )
        else:
            raise HTTPException(
                status_code=500, 
                detail=result.get("error", "Failed to toggle light")
            )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to toggle printer light: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/light/on", response_model=BaseResponse)
async def turn_printer_light_on(printer_id: str):
    """
    Turn printer chamber light on
    
    Sets the chamber light to the on state for the specified printer.
    """
    try:
        result = await printer_manager.set_light_state(printer_id, True)
        
        if result.get("success"):
            return BaseResponse(
                success=True,
                message=result.get("message", f"Light turned on for printer {printer_id}")
            )
        else:
            raise HTTPException(
                status_code=500, 
                detail=result.get("error", "Failed to turn on light")
            )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to turn on printer light: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{printer_id}/light/off", response_model=BaseResponse)
async def turn_printer_light_off(printer_id: str):
    """
    Turn printer chamber light off
    
    Sets the chamber light to the off state for the specified printer.
    """
    try:
        result = await printer_manager.set_light_state(printer_id, False)
        
        if result.get("success"):
            return BaseResponse(
                success=True,
                message=result.get("message", f"Light turned off for printer {printer_id}")
            )
        else:
            raise HTTPException(
                status_code=500, 
                detail=result.get("error", "Failed to turn off light")
            )
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to turn off printer light: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{printer_id}/light/status", response_model=dict)
async def get_printer_light_status(printer_id: str):
    """
    Get current status of printer chamber light
    
    Returns the current light state (on/off) and availability status.
    """
    try:
        result = await printer_manager.get_light_status(printer_id)
        
        return {
            "success": True,
            "message": f"Light status retrieved for printer {printer_id}",
            "light_on": result.get("is_on", False),
            "available": result.get("available", True),
            "error": result.get("error")
        }
        
    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except PrinterConnectionError as e:
        logger.error(f"Printer connection error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get printer light status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{printer_id}/cleared/toggle", response_model=BaseResponse)
async def toggle_printer_cleared_status(printer_id: str):
    """
    Toggle printer cleared status

    Toggles the cleared status for a printer. When false, indicates the printer
    bed needs to be cleared before starting a new print.
    """
    try:
        import sqlite3
        from datetime import datetime

        # Direct SQLite access
        db_path = "/home/pi/PrintFarmSoftware/data/tenant.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Get current cleared status
        cursor.execute("""
            SELECT cleared FROM printers WHERE printer_id = ?
        """, (int(printer_id),))

        result = cursor.fetchone()
        if not result:
            conn.close()
            raise PrinterNotFoundError(f"Printer {printer_id} not found")

        current_cleared = result[0]
        new_status = not bool(current_cleared) if current_cleared is not None else True

        # Toggle the cleared status
        cursor.execute("""
            UPDATE printers
            SET cleared = ?,
                updated_at = ?
            WHERE printer_id = ?
        """, (1 if new_status else 0, datetime.utcnow().isoformat(), int(printer_id)))

        conn.commit()
        conn.close()

        return BaseResponse(
            success=True,
            message=f"Printer cleared status updated to {new_status}"
        )

    except PrinterNotFoundError as e:
        logger.error(f"Printer not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to toggle printer cleared status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status-quick")
async def debug_status_quick():
    """Quick status check for all printers - returns live print status"""
    try:
        quick_status = []

        for printer_id in printer_manager.printer_configs.keys():
            config = printer_manager.printer_configs[printer_id]
            is_connected = printer_id in printer_manager.clients

            # Get live status if connected
            status = "offline"
            if is_connected:
                try:
                    # Use the comprehensive live status method with timeout
                    live_status = await asyncio.wait_for(
                        printer_manager.get_live_print_status(printer_id),
                        timeout=2.0
                    )
                    # Extract status from live status response
                    status = live_status.get("status", "idle")
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout getting live status for printer {printer_id}, defaulting to idle")
                    status = "idle"
                except Exception as e:
                    logger.warning(f"Error getting live status for printer {printer_id}: {e}, defaulting to idle")
                    status = "idle"

            quick_status.append({
                "printer_id": printer_id,
                "name": config.get("name", "Unknown"),
                "model": config.get("model", "Unknown"),
                "connected": is_connected,
                "status": status
            })

        return {
            "success": True,
            "printers": quick_status
        }
    except Exception as e:
        import traceback
        logger.error(f"Failed to get quick printer status: {e}")
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "printers": []
        }

@router.get("/status-quick-fixed")
async def get_printer_status_quick_fixed():
    """Working version of status-quick that returns both printers"""
    quick_status = []
    
    for printer_id in printer_manager.printer_configs.keys():
        config = printer_manager.printer_configs[printer_id]
        is_connected = printer_id in printer_manager.clients
        
        quick_status.append({
            "printer_id": printer_id,
            "name": config.get("name", "Unknown"),
            "model": config.get("model", "Unknown"),
            "connected": is_connected,
            "status": "idle" if is_connected else "offline"
        })
    
    return {
        "success": True,
        "printers": quick_status
    }

@router.post("/{printer_id}/enable")
async def enable_printer(printer_id: str):
    """
    Re-enable a disabled printer and reset failure counters

    This endpoint allows manually re-enabling a printer that was auto-disabled
    due to consecutive connection failures. It resets all failure tracking.
    """
    try:
        from src.services.database_service import get_database_service
        from sqlalchemy import text
        from datetime import datetime

        db_service = await get_database_service()

        async with db_service.get_session() as session:
            # First check if printer exists
            check_query = text("SELECT id, name FROM printers WHERE id = :printer_id")
            result = await session.execute(check_query, {'printer_id': printer_id})
            printer = result.fetchone()

            if not printer:
                raise HTTPException(status_code=404, detail=f"Printer {printer_id} not found")

            printer_name = printer[1]

            # Re-enable the printer and reset failure tracking
            update_query = text("""
                UPDATE printers
                SET is_active = 1,
                    consecutive_failures = 0,
                    disabled_reason = NULL,
                    disabled_at = NULL,
                    updated_at = :timestamp
                WHERE id = :printer_id
            """)

            await session.execute(update_query, {
                'timestamp': datetime.utcnow().isoformat(),
                'printer_id': printer_id
            })

            await session.commit()

            logger.info(f"Manually re-enabled printer {printer_name} (id: {printer_id})")

            return {
                "success": True,
                "message": f"Printer {printer_name} has been re-enabled",
                "printer_id": printer_id
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error enabling printer {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to enable printer: {str(e)}")
