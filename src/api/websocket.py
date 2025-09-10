from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json
import logging
from typing import Dict, Set
from src.models.responses import LivePrintStatus, LiveStatusUpdate, PrintJobStatus, PrintProgress, TemperatureStatus, TemperatureInfo
from src.core.printer_client import printer_manager
from src.utils.exceptions import PrinterNotFoundError, PrinterConnectionError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WebSocket Live Status"])

class ConnectionManager:
    """Manages WebSocket connections for live status streaming"""
    
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.all_printers_connections: Set[WebSocket] = set()
    
    async def connect_single_printer(self, websocket: WebSocket, printer_id: str):
        """Connect client to single printer status updates"""
        await websocket.accept()
        if printer_id not in self.active_connections:
            self.active_connections[printer_id] = set()
        self.active_connections[printer_id].add(websocket)
        logger.info(f"Client connected to printer {printer_id} status stream")
    
    async def connect_all_printers(self, websocket: WebSocket):
        """Connect client to all printers status updates"""
        await websocket.accept()
        self.all_printers_connections.add(websocket)
        logger.info("Client connected to all printers status stream")
    
    def disconnect_single_printer(self, websocket: WebSocket, printer_id: str):
        """Disconnect client from single printer updates"""
        if printer_id in self.active_connections:
            self.active_connections[printer_id].discard(websocket)
            if not self.active_connections[printer_id]:
                del self.active_connections[printer_id]
        logger.info(f"Client disconnected from printer {printer_id} status stream")
    
    def disconnect_all_printers(self, websocket: WebSocket):
        """Disconnect client from all printers updates"""
        self.all_printers_connections.discard(websocket)
        logger.info("Client disconnected from all printers status stream")
    
    async def send_to_printer_subscribers(self, printer_id: str, message: dict):
        """Send message to all subscribers of a specific printer"""
        if printer_id in self.active_connections:
            disconnected = []
            for websocket in self.active_connections[printer_id].copy():
                try:
                    await websocket.send_text(json.dumps(message))
                except Exception as e:
                    logger.warning(f"Failed to send to client: {e}")
                    disconnected.append(websocket)
            
            # Clean up disconnected clients
            for websocket in disconnected:
                self.active_connections[printer_id].discard(websocket)
    
    async def send_to_all_subscribers(self, message: dict):
        """Send message to all subscribers of the all-printers stream"""
        disconnected = []
        for websocket in self.all_printers_connections.copy():
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.warning(f"Failed to send to all-printers client: {e}")
                disconnected.append(websocket)
        
        # Clean up disconnected clients
        for websocket in disconnected:
            self.all_printers_connections.discard(websocket)

manager = ConnectionManager()

def convert_to_response_models(status_data: Dict) -> LivePrintStatus:
    """Convert raw status data to response models"""
    # Convert temperatures
    temp_data = status_data.get("temperatures", {})
    temperatures = TemperatureStatus(
        nozzle=TemperatureInfo(**temp_data.get("nozzle", {"current": 0.0, "target": 0.0, "is_heating": False})),
        bed=TemperatureInfo(**temp_data.get("bed", {"current": 0.0, "target": 0.0, "is_heating": False})),
        chamber=TemperatureInfo(**temp_data.get("chamber", {"current": 0.0, "target": 0.0, "is_heating": False}))
    )
    
    # Convert progress if available
    progress = None
    if status_data.get("progress"):
        progress_data = status_data["progress"]
        progress = PrintProgress(
            percentage=progress_data.get("percentage", 0.0),
            elapsed_time=progress_data.get("elapsed_time", 0),
            remaining_time=progress_data.get("remaining_time"),
            current_layer=progress_data.get("current_layer"),
            total_layers=progress_data.get("total_layers")
        )
    
    # Convert status
    status = PrintJobStatus(status_data.get("status", "idle"))
    
    return LivePrintStatus(
        printer_id=status_data["printer_id"],
        status=status,
        progress=progress,
        temperatures=temperatures,
        light_on=status_data.get("light_on", False)
    )

@router.websocket("/ws/live-status/{printer_id}")
async def websocket_single_printer_status(websocket: WebSocket, printer_id: str):
    """
    WebSocket endpoint for live status updates of a single printer
    
    Streams real-time updates including:
    - Print progress (percentage, time, layers)
    - Print status (idle, printing, paused, etc.)
    - Temperature readings (nozzle, bed, chamber)
    
    Updates are sent every 2 seconds while connected.
    """
    await manager.connect_single_printer(websocket, printer_id)
    
    try:
        # Verify printer exists
        if printer_id not in printer_manager.printer_configs:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": f"Printer {printer_id} not found"
            }))
            return
        
        # Send initial status
        try:
            if printer_id in printer_manager.clients:
                status_data = await printer_manager.get_live_print_status(printer_id)
                live_status = convert_to_response_models(status_data)
                update = LiveStatusUpdate(data=live_status)
                await websocket.send_text(update.model_dump_json())
            else:
                # Send offline status
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Printer {printer_id} not connected"
                }))
        except Exception as e:
            logger.error(f"Failed to get initial status for {printer_id}: {e}")
            await websocket.send_text(json.dumps({
                "type": "error", 
                "message": f"Failed to get printer status: {str(e)}"
            }))
        
        # Stream live updates
        while True:
            try:
                # Wait for 2 seconds between updates
                await asyncio.sleep(2)
                
                # Check if printer is still connected
                if printer_id not in printer_manager.clients:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Printer {printer_id} disconnected"
                    }))
                    continue
                
                # Get live status
                status_data = await printer_manager.get_live_print_status(printer_id)
                live_status = convert_to_response_models(status_data)
                update = LiveStatusUpdate(data=live_status)
                
                # Send update to this specific client
                await websocket.send_text(update.model_dump_json())
                
            except PrinterConnectionError as e:
                logger.warning(f"Printer connection error for {printer_id}: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Printer connection error: {str(e)}"
                }))
                await asyncio.sleep(5)  # Wait longer on connection errors
            except Exception as e:
                logger.error(f"Error in live status stream for {printer_id}: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Stream error: {str(e)}"
                }))
                break
                
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from printer {printer_id} status stream")
    except Exception as e:
        logger.error(f"WebSocket error for printer {printer_id}: {e}")
    finally:
        manager.disconnect_single_printer(websocket, printer_id)

@router.websocket("/ws/live-status-all")
async def websocket_all_printers_status(websocket: WebSocket):
    """
    WebSocket endpoint for live status updates of all configured printers
    
    Streams real-time updates for all printers including:
    - Print progress for each printer
    - Print status for each printer  
    - Temperature readings for each printer
    
    Updates are sent every 3 seconds while connected.
    """
    await manager.connect_all_printers(websocket)
    
    try:
        # Send initial status for all printers
        try:
            all_status_data = await printer_manager.get_all_live_status()
            live_statuses = [convert_to_response_models(status) for status in all_status_data]
            update = LiveStatusUpdate(data=live_statuses)
            await websocket.send_text(update.model_dump_json())
        except Exception as e:
            logger.error(f"Failed to get initial status for all printers: {e}")
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": f"Failed to get printers status: {str(e)}"
            }))
        
        # Stream live updates for all printers
        while True:
            try:
                # Wait for 3 seconds between updates (slightly longer for all printers)
                await asyncio.sleep(3)
                
                # Get live status for all printers
                all_status_data = await printer_manager.get_all_live_status()
                live_statuses = [convert_to_response_models(status) for status in all_status_data]
                update = LiveStatusUpdate(data=live_statuses)
                
                # Send update to this specific client
                await websocket.send_text(update.model_dump_json())
                
            except Exception as e:
                logger.error(f"Error in all printers live status stream: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Stream error: {str(e)}"
                }))
                break
                
    except WebSocketDisconnect:
        logger.info("Client disconnected from all printers status stream")
    except Exception as e:
        logger.error(f"WebSocket error for all printers: {e}")
    finally:
        manager.disconnect_all_printers(websocket)

@router.get("/live-status/all")
async def get_all_printers_live_status():
    """
    HTTP endpoint to get current live status of all printers
    
    This is a one-time status check, not a stream.
    Use the WebSocket endpoint for continuous updates.
    """
    try:
        all_status_data = await printer_manager.get_all_live_status()
        live_statuses = [convert_to_response_models(status) for status in all_status_data]
        
        return LiveStatusUpdate(data=live_statuses)
        
    except Exception as e:
        logger.error(f"Failed to get live status for all printers: {e}")
        raise

@router.get("/live-status/{printer_id}")
async def get_single_printer_live_status(printer_id: str):
    """
    HTTP endpoint to get current live status of a single printer
    
    This is a one-time status check, not a stream.
    Use the WebSocket endpoint for continuous updates.
    """
    try:
        if printer_id not in printer_manager.printer_configs:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        
        if printer_id not in printer_manager.clients:
            raise PrinterConnectionError(f"Printer {printer_id} not connected")
        
        status_data = await printer_manager.get_live_print_status(printer_id)
        live_status = convert_to_response_models(status_data)
        
        return LiveStatusUpdate(data=live_status)
        
    except Exception as e:
        logger.error(f"Failed to get live status for printer {printer_id}: {e}")
        raise